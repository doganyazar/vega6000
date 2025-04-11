import {
  fillPattern,
  formatIframeInterval,
  parseJSVarsTextToJson,
  sleep,
} from "./utils";

export type AudioCodec = "aac_lc" | "aac_he" | "aac_hev2" | "ac3" | "mp2";
export type VideoCodec = "h264" | "h265";
export type VideoCodecWithOff = VideoCodec | "off";
export type SDIPort = 1 | 2 | 3 | 4;
export type ImageSize = "1280,720" | "1920,1080";

interface InputConfig {
  interface: "sdi";
  port: SDIPort;
}

export interface GopConfig {
  bFrames: number; // X: Number of B-frames between P-frames
  gopLength: number; // Y: GOP length (N)
  idrInterval: number; // Z: Number of GOPs between IDR frames
}

interface VideoConfig {
  codec: VideoCodecWithOff;
  imageSize: ImageSize;
  bitrate: number; // [64 to 64000] in kbps
  gop?: GopConfig;
  rateControl?: "CBR" | "VBR" | "CVBR" | "low-latency";
  // NV12: 4:2:0 8bit
  // NV16: 4:2:0 10bit
  // XV15: 4:2:2 8bit
  // XV20: 4:2:2 10bit
  pixelFormat?: "NV12" | "NV16" | "XV15" | "XV20";
}

interface AudioConfig {
  codec: AudioCodec;
  bitrate: number; // in kbps
  // 0
  // 32000
  // 44100
  // 48000
  sampleRate: number; // Hz
  // 1 : channel 1 & 2
  // 2 : channel 3 & 4
  // 3 : channel 5 & 6
  // 4 : channel 7 & 8
  pair: 1 | 2 | 3 | 4;
}

interface EncodeConfig {
  video: VideoConfig;
  audio: AudioConfig[];
  scte104To35Conversion?: boolean; // default: false
}

interface OutputConfig {
  // only "RTMP" | "RTP" | "UDP" | "SRT" supported
  url: string; // e.g. rtmp://server/live
}

export interface StreamConfig {
  id: SDIPort;
  input: InputConfig;
  encoding: EncodeConfig;
  output: OutputConfig;
  noRePipeline?: boolean; // optimization to skip re_pipeline if not needed
}

// same with StreamConfig but input is optional
export type StreamConfigInput = Omit<StreamConfig, "input"> & {
  input?: InputConfig;
};

export type CGI =
  | "system"
  | "av_input"
  | "video"
  | "encode"
  | "stream"
  | "video_input_status"
  | "misc";

enum StreamProtocol {
  TSoverIP = "TSoverIP",
  TSoverRTP = "TSoverRTP",
  RTP = "RTP",
  SRT = "SRT",
  off = "off",
}

const SLEEP_AFTER_COMMAND = Number(process.env.SLEEP_AFTER_COMMAND) || 0;

function applyDefaults(config: StreamConfigInput): StreamConfig {
  const { id } = config;
  const input = config.input || { interface: "sdi", port: id };
  return {
    ...config,
    input,
  };
}

interface Vega6000StreamApiOpts {
  baseUrl: string;
  auth: {
    username: string;
    password: string;
  };
}
interface HTTPRetryOpts {
  maxRetries: number;
  retryDelay: number;
}

const DefaultHTTPRetryOpts: HTTPRetryOpts = {
  maxRetries: 5,
  retryDelay: 1000,
};

export class Vega6000StreamApi {
  private audioChannelCount = 0;
  constructor(private opts: Vega6000StreamApiOpts) {}

  private async configureEncoder(config: StreamConfig): Promise<void> {
    await this.configureVideoEncoder(config);
    await this.configureScte(config);
    await this.configureAudioEncoder(config);

    if (!config.noRePipeline) {
      // re_pipeline is required to apply changes on video encoding
      // API docs say this is part of "encode" module but it works on video too
      await this.sendCommand("video", { re_pipeline: "on" });
    }
  }

  private async configureVideoEncoder(config: StreamConfig): Promise<void> {
    const {
      input,
      encoding: { video },
      id,
    } = config;

    const variableParams = [
      [fillPattern("EncVidCodec$1", [id]), video.codec],
      [fillPattern("EncVidCodecSrcId$1", [id]), input.port - 1], // SDI channel is 0-indexed
      [fillPattern("ImageSize$1", [id]), video.imageSize],
      [fillPattern("BitRate$1", [id]), video.bitrate],
      [fillPattern("IFrameInterval$1", [id]), formatIframeInterval(video.gop)],
      [fillPattern("PixelFormat$1", [id]), video.pixelFormat],
    ];

    await this.sendCommand("video", Object.fromEntries(variableParams));
  }

  private async configureAudioEncoder(config: StreamConfig): Promise<void> {
    const {
      input,
      encoding: { audio },
    } = config;

    const sdiIndex = input.port - 1; // SDI channel is 0-indexed
    let variableParams: Array<[string, any]> = [];

    for (let i = 0; i < audio.length; i++) {
      const audioConfig = audio[i];
      const audioCodecIndex = i + 1 + this.audioChannelCount;

      if (audioCodecIndex > 8) {
        throw new Error("Only 8 audio encodings are supported");
      }

      variableParams = variableParams.concat([
        [fillPattern("EncAudSrcId$1", [audioCodecIndex]), sdiIndex],
        [fillPattern("EncAudCodec$1", [audioCodecIndex]), audioConfig.codec],
        [fillPattern("EncAudSrcStereo$1", [audioCodecIndex]), audioConfig.pair],
        [fillPattern("AudBitRate$1", [audioCodecIndex]), audioConfig.bitrate],
        [
          fillPattern("AudSampleRate$1", [audioCodecIndex]),
          audioConfig.sampleRate,
        ],
      ]);
    }

    await this.sendCommand("av_input", Object.fromEntries(variableParams));
  }

  private async configureScte(config: StreamConfig): Promise<void> {
    const {
      id,
      encoding: { scte104To35Conversion = false },
    } = config;

    let variableParams: (string | number)[][] = [
      [
        fillPattern("Channel$1AncEnable1", [id]),
        scte104To35Conversion ? "on" : "off",
      ],
    ];

    if (scte104To35Conversion) {
      variableParams = variableParams.concat([
        [fillPattern("Channel$1AncDID1", [id]), 577],
        [fillPattern("Channel$1AncSDID1", [id]), 263],
      ]);
    }

    await this.sendCommand("av_input", Object.fromEntries(variableParams));
  }

  private async configureOutput(config: StreamConfig): Promise<void> {
    const {
      id,
      encoding: { audio },
      output,
    } = config;
    const { hostname, port, protocol } = new URL(output.url);
    let variableParams: Array<[string, any]> = [];

    switch (protocol) {
      case "rtmp:":
        // TODO: implement
        break;
      case "rtp:":
        variableParams = [
          [fillPattern("Channel$1Protocol1", [id]), StreamProtocol.TSoverRTP],
          [fillPattern("Channel$1RTPclientIP1", [id]), hostname],
          [fillPattern("Channel$1RTPclientPort1", [id]), port],
          [fillPattern("Channel$1RTPVideo1EncId1", [id]), id], // Video1: only 1 video in ts supported, use nth encoder for nth stream
          [fillPattern("Channel$1RTPVideoPid1", [id]), 100],
          [fillPattern("Channel$1RTPAudio1Pid1", [id]), 101],
          [fillPattern("Channel$1RTPAudio2Pid1", [id]), 102],
          [fillPattern("Channel$1RTPAudio3Pid1", [id]), 103],
          [fillPattern("Channel$1RTPAudio4Pid1", [id]), 104],
          [fillPattern("Channel$1RTPPcrPid1", [id]), 100],
          [fillPattern("Channel$1RTPPcrCheck1", [id]), 1],
        ];

        // Add audio encoding parameters - up to 4 channels supported, set them to 0 if not present
        for (let i = 0; i < 4; i++) {
          // supports up to 4 audio channels
          const audioConfig = audio[i];
          const audioIndexPerStream = i + 1;
          const whichAudioCodec = audioConfig
            ? audioIndexPerStream + this.audioChannelCount
            : 0;
          variableParams.push([
            // shall match EncAudCodec[n] params
            fillPattern("Channel$1RTPAudio$2EncId1", [id, audioIndexPerStream]),
            whichAudioCodec,
          ]);
        }

        break;
      case "udp:":
        variableParams = [
          [fillPattern("Channel$1Protocol1", [id]), StreamProtocol.TSoverIP],
          [fillPattern("Channel$1TSprotocol1", [id]), "udp"],
          [fillPattern("Channel$1TSclientIP1", [id]), hostname],
          [fillPattern("Channel$1TSclientPort1", [id]), port],
          [fillPattern("Channel$1TSTTL1", [id]), 64],
          [fillPattern("Channel$1TSVideoPid1", [id]), 100],
          [fillPattern("Channel$1TSAudioPid1", [id]), 101],
          [fillPattern("Channel$1TSAudio2Pid1", [id]), 102],
          [fillPattern("Channel$1TSAudio3Pid1", [id]), 103],
          [fillPattern("Channel$1TSAudio4Pid1", [id]), 104],
          [fillPattern("Channel$1TSPcrPid1", [id]), 100],
          [fillPattern("Channel$1TSPcrCheck1", [id]), 1],
          [fillPattern("Channel$1TSAudio1EncId1", [id]), 1],
          [fillPattern("Channel$1TSAudio2EncId1", [id]), 0],
          [fillPattern("Channel$1TSAudio3EncId1", [id]), 0],
          [fillPattern("Channel$1TSAudio4EncId1", [id]), 0],
        ];
        break;
      case "srt:":
        // TODO: implement
        break;
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }

    await this.sendCommand("stream", Object.fromEntries(variableParams));
  }

  private async createStream(configInput: StreamConfigInput): Promise<void> {
    const config = applyDefaults(configInput);
    try {
      await this.configureEncoder(config);
      await this.configureOutput(config);

      this.audioChannelCount += config.encoding.audio.length;
    } catch (err: any) {
      throw new Error(`Failed to create stream: ${err.message || err}`);
    }
  }

  public async createStreams(configs: StreamConfigInput[]): Promise<void> {
    this.audioChannelCount = 0;
    for (const config of configs) {
      await this.createStream(config);
    }
  }

  public async disableStreams(ids: number | number[]): Promise<void> {
    const idsArray = Array.isArray(ids) ? ids : [ids];

    // Turn off SCTE104 to 35
    const avInputVariableParams = idsArray.map((id) => [
      fillPattern("Channel$1AncEnable1", [id]),
      "off",
    ]);
    await this.sendCommand(
      "av_input",
      Object.fromEntries(avInputVariableParams)
    );

    const streamVariableParams = idsArray.map((id) => [
      fillPattern("Channel$1Protocol1", [id]),
      "off",
    ]);
    return this.sendCommand("stream", Object.fromEntries(streamVariableParams));
  }

  public async reset(): Promise<void> {
    this.audioChannelCount = 0;
    return this.disableStreams([1, 2, 3, 4]);
  }

  private async _get(path: string) {
    const url = `${this.opts.baseUrl}/command/${path}`;
    console.log("GET", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${btoa(
          `${this.opts.auth.username}:${this.opts.auth.password}`
        )}`,
      },
      // Somehow agent does not work with bun so instead setting tls option
      // @ts-expect-error - Bun-specific TLS options
      tls: { rejectUnauthorized: false },
    });

    if (!response.ok) {
      throw new Error(`Command failed for ${path} - ${response.statusText}`);
    }

    return response.text();
  }

  private async get(path: string, opts?: HTTPRetryOpts): Promise<string> {
    const { maxRetries, retryDelay } = opts || DefaultHTTPRetryOpts;

    let retry = 0;

    do {
      try {
        if (retry > 0) {
          console.log(`Retrying ${path} (${retry}/${maxRetries})`);
          await sleep(retryDelay);
        }
        return await this._get(path);
      } catch (err: any) {
        if (err.statusCode !== 503) throw err;
      }
    } while (retry++ < maxRetries);

    throw new Error(`Max retries exceeded for GET ${path}: ${maxRetries}`);
  }

  public async inquiry(resources: CGI[]): Promise<string> {
    const params = resources.map((resource) => `inqjs=${resource}`).join("&");
    const response = await this.get(`inquiry.cgi?${params}`);
    return response;
  }

  public async inquiryJson(resources: CGI[]): Promise<Record<string, string>> {
    const response = await this.inquiry(resources);
    return parseJSVarsTextToJson(response);
  }

  private async sendCommand(
    module: CGI,
    params: Record<string, any>
  ): Promise<void> {
    const queryString = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    await this.get(`${module}.cgi?${queryString}`);
    if (SLEEP_AFTER_COMMAND) {
      await sleep(SLEEP_AFTER_COMMAND);
    }
  }
}

if (import.meta.main) {
  const stream1 = {
    id: 1 as const,
    input: {
      interface: "sdi" as const,
      port: 1 as const,
    },
    encoding: {
      video: {
        codec: "h265" as const,
        bitrate: 10000,
        imageSize: "1920,1080" as const,
        gop: {
          bFrames: 1,
          gopLength: 60,
          idrInterval: 1,
        },
        pixelFormat: "XV20" as const, // 4:2:2 10bit
      },
      audio: [
        {
          codec: "aac_lc" as const,
          bitrate: 64000,
          sampleRate: 48000,
          pair: 1 as const,
        },
        {
          codec: "ac3" as const,
          bitrate: 32000,
          sampleRate: 32000,
          pair: 1 as const,
        },
      ],
    },
    output: {
      url: "rtp://127.0.0.1:4010",
    },
  };

  const HOST = process.env.HOST || "127.0.0.1";
  const streamer = new Vega6000StreamApi({
    baseUrl: `http://${HOST}`,
    auth: {
      username: "root",
      password: "edgeedge",
    },
  });

  await streamer.createStreams([stream1]);
  await streamer.inquiry(["av_input", "video", "encode", "stream"]);
  console.log("Stream created successfully!");
}
