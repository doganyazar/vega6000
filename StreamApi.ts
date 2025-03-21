import { areSetsEqual, sleep } from "./utils";

export type AudioCodec = "aac_lc" | "aac_he" | "aac_hev2" | "ac3" | "mp2";
export type VideoCodec = "h264" | "h265";
export type VideoCodecWithOff = VideoCodec | "off";
export type SDIPort = 1 | 2 | 3 | 4;
export type ImageSize = "1280,720" | "1920,1080";

interface InputConfig {
  interface: "sdi";
  port: SDIPort;
}

interface GopConfig {
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
}

// same with StreamConfig but input is optional
export type StreamConfigInput = Omit<StreamConfig, "input"> & {
  input?: InputConfig;
};

type CGI = "system" | "av_input" | "video" | "encode" | "stream" | "misc";

enum StreamProtocol {
  TSoverIP = "TSoverIP",
  TSoverRTP = "TSoverRTP",
  RTP = "RTP",
  SRT = "SRT",
  off = "off",
}

const SLEEP_AFTER_COMMAND = Number(process.env.SLEEP_AFTER_COMMAND) || 0;

function fill(pattern: string, values: any[]): string {
  function checkPattern() {
    const vars = pattern.match(/\$[0-9]+/g) || [];
    const count = vars.length;
    const expectedVars = new Set(
      new Array(count).fill(0).map((_, i) => `$${i + 1}`)
    );

    if (!areSetsEqual(new Set(vars), expectedVars)) {
      throw new Error(`Invalid pattern: ${pattern}`);
    }
    if (count !== values.length) {
      throw new Error(
        `Number of values (${values.length}) does not match number of placeholders (${count})`
      );
    }
  }

  checkPattern();

  return values.reduce((result, value, index) => {
    return result.replace(`$${index + 1}`, value.toString());
  }, pattern);
}

function applyDefaults(config: StreamConfigInput): StreamConfig {
  const { id } = config;
  const input = config.input || { interface: "sdi", port: id };
  return {
    ...config,
    input,
  };
}

interface StreamAPIOpts {
  baseUrl: string;
  auth: {
    username: string;
    password: string;
  };
}

const formatIframeInterval = (gop?: GopConfig): string | undefined => {
  if (!gop) return undefined;
  const { bFrames, gopLength, idrInterval } = gop;
  return `${bFrames},${gopLength},${idrInterval}`;
};

export class StreamAPI {
  private audioChannelCount = 0;
  constructor(private opts: StreamAPIOpts) {}

  private async configureEncoder(config: StreamConfig): Promise<void> {
    await this.configureVideoEncoder(config);
    await this.configureAudioEncoder(config);
  }

  private async configureVideoEncoder(config: StreamConfig): Promise<void> {
    const {
      input,
      encoding: { video },
      id,
    } = config;

    const variableParams = [
      [fill("EncVidCodec$1", [id]), video.codec],
      [fill("EncVidCodecSrcId$1", [id]), input.port - 1], // SDI channel is 0-indexed
      [fill("ImageSize$1", [id]), video.imageSize],
      [fill("BitRate$1", [id]), video.bitrate],
      [fill("IFrameInterval$1", [id]), formatIframeInterval(video.gop)],
      [fill("PixelFormat$1", [id]), video.pixelFormat],
    ];

    const params = {
      ...Object.fromEntries(variableParams),
      re_pipeline: "on", // API docs say this is part of "encode" module but it works here too
    };

    await this.sendCommand("video", params);
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
        [fill("EncAudSrcId$1", [audioCodecIndex]), sdiIndex],
        [fill("EncAudCodec$1", [audioCodecIndex]), audioConfig.codec],
        [fill("EncAudSrcStereo$1", [audioCodecIndex]), audioConfig.pair],
        [fill("AudBitRate$1", [audioCodecIndex]), audioConfig.bitrate],
        [fill("AudSampleRate$1", [audioCodecIndex]), audioConfig.sampleRate],
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
          [fill("Channel$1Protocol1", [id]), StreamProtocol.TSoverRTP],
          [fill("Channel$1RTPclientIP1", [id]), hostname],
          [fill("Channel$1RTPclientPort1", [id]), port],
          [fill("Channel$1RTPVideo1EncId1", [id]), id], // Video1: only 1 video in ts supported, use nth encoder for nth stream
          [fill("Channel$1RTPVideoPid1", [id]), 100],
          [fill("Channel$1RTPAudio1Pid1", [id]), 101],
          [fill("Channel$1RTPAudio2Pid1", [id]), 102],
          [fill("Channel$1RTPAudio3Pid1", [id]), 103],
          [fill("Channel$1RTPAudio4Pid1", [id]), 104],
          [fill("Channel$1RTPPcrPid1", [id]), 100],
          [fill("Channel$1RTPPcrCheck1", [id]), 1],
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
            fill("Channel$1RTPAudio$2EncId1", [id, audioIndexPerStream]),
            whichAudioCodec,
          ]);
        }

        break;
      case "udp:":
        variableParams = [
          [fill("Channel$1Protocol1", [id]), StreamProtocol.TSoverIP],
          [fill("Channel$1TSprotocol1", [id]), "udp"],
          [fill("Channel$1TSclientIP1", [id]), hostname],
          [fill("Channel$1TSclientPort1", [id]), port],
          [fill("Channel$1TSTTL1", [id]), 64],
          [fill("Channel$1TSVideoPid1", [id]), 100],
          [fill("Channel$1TSAudioPid1", [id]), 101],
          [fill("Channel$1TSAudio2Pid1", [id]), 102],
          [fill("Channel$1TSAudio3Pid1", [id]), 103],
          [fill("Channel$1TSAudio4Pid1", [id]), 104],
          [fill("Channel$1TSPcrPid1", [id]), 100],
          [fill("Channel$1TSPcrCheck1", [id]), 1],
          [fill("Channel$1TSAudio1EncId1", [id]), 1],
          [fill("Channel$1TSAudio2EncId1", [id]), 0],
          [fill("Channel$1TSAudio3EncId1", [id]), 0],
          [fill("Channel$1TSAudio4EncId1", [id]), 0],
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
    const variableParams = idsArray.map((id) => [
      fill("Channel$1Protocol1", [id]),
      "off",
    ]);
    return this.sendCommand("stream", Object.fromEntries(variableParams));
  }

  public async reset(): Promise<void> {
    this.audioChannelCount = 0;
    return this.disableStreams([1, 2, 3, 4]);
  }

  private async get(path: string) {
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

  public async inquiry(resources: CGI[]): Promise<void> {
    const params = resources.map((resource) => `inqjs=${resource}`).join("&");
    const response = await this.get(`inquiry.cgi?${params}`);
    console.log(response);
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
  const streamer = new StreamAPI({
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
