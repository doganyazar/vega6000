import {
  type ImageSize,
  type PixelFormat,
  type SDIPort,
  type StreamConfigInput,
  type VideoCodec,
} from "./Vega6000StreamApi";

const ENV_PORT_BEGIN = parseInt(process.env.PORT_BEGIN || "", 10);
const ENV_PIXEL_FORMAT = process.env.PIXEL_FORMAT as PixelFormat;
const ENV_PROTOCOL = process.env.PROTOCOL as "udp" | "rtp" | "srt";
const ENV_SRT_MODE = process.env.SRT_MODE;
const ENV_TARGET_IP =
  process.env.TARGET_IP ||
  (ENV_SRT_MODE === "listener" ? process.env.HOST : ""); // if srt is enabled in listener mode, use HOST as target IP

const DEFAULT_AUDITO_BITRATE = 48000;
const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

interface MakeStreamOpts {
  id: SDIPort;
  video: {
    codec: VideoCodec;
    bitrate?: number;
    imageSize?: ImageSize;
    pixelFormat?: PixelFormat;
  };
  audio: {
    codec: "aac_lc" | "ac3";
    bitrate?: number;
  }[];
  scte104To35Conversion?: boolean;
  targetIp?: string;
  protocol?: "udp" | "rtp" | "srt";
  port: number;
}

function makeStream({
  id,
  video: {
    codec,
    bitrate = 15000,
    imageSize = "1280,720",
    pixelFormat = "XV20",
  },
  audio,
  scte104To35Conversion,
  targetIp = "127.0.0.1",
  protocol = "rtp",
  port,
}: MakeStreamOpts): StreamConfigInput {
  const audioConfig = audio.map(
    ({ codec, bitrate = DEFAULT_AUDITO_BITRATE }) => ({
      codec,
      bitrate,
      sampleRate: DEFAULT_AUDIO_SAMPLE_RATE,
      pair: 1 as const,
    })
  );

  const url = new URL(`${protocol}://${targetIp}:${port}`);
  if (ENV_SRT_MODE) {
    url.searchParams.set("mode", ENV_SRT_MODE);
  }

  return {
    id,
    encoding: {
      video: {
        codec,
        bitrate,
        imageSize,
        pixelFormat,
      },
      audio: audioConfig,
      scte104To35Conversion,
    },
    output: {
      url: url.href,
    },
  };
}

function makeSimilarStreams(opts: MakeStreamOpts, count: number) {
  return Array.from({ length: count }, (_, i) => {
    return makeStream({
      ...opts,
      id: (i + 1) as SDIPort,
      targetIp: opts.targetIp || ENV_TARGET_IP,
      port: opts.port + i * 10,
    });
  });
}

interface EncodeScenarioOpts {
  count: number;
  videoCodec: VideoCodec;
  bitrate?: number;
  imageSize?: ImageSize;
  scte104To35Conversion?: boolean;
  pixelFormat?: PixelFormat;
}

export function Encode_Main(opts: EncodeScenarioOpts): StreamConfigInput[] {
  const {
    count,
    videoCodec,
    bitrate = 15000,
    imageSize = "1280,720",
    scte104To35Conversion,
    pixelFormat = ENV_PIXEL_FORMAT,
  } = opts;

  const protocol = ENV_PROTOCOL || ENV_SRT_MODE ? "srt" : "rtp";

  const streams = makeSimilarStreams(
    {
      id: 1,
      video: {
        codec: videoCodec,
        bitrate,
        imageSize,
        pixelFormat,
      },
      audio: [{ codec: "aac_lc" }],
      scte104To35Conversion,
      port: ENV_PORT_BEGIN || 4010,
      protocol,
    },
    count
  );
  console.log("Streams", JSON.stringify(streams, null, 2));
  return streams;
}

export const Encode_Double_Stereo = (
  opts: EncodeScenarioOpts
): StreamConfigInput[] => {
  const {
    count,
    videoCodec,
    bitrate = 15000,
    imageSize = "1280,720",
    scte104To35Conversion,
    pixelFormat = ENV_PIXEL_FORMAT,
  } = opts;
  const streams = makeSimilarStreams(
    {
      id: 1,
      video: {
        codec: videoCodec,
        bitrate,
        imageSize,
        pixelFormat,
      },
      audio: [{ codec: "aac_lc" }, { codec: "aac_lc" }],
      scte104To35Conversion,
      port: ENV_PORT_BEGIN || 4010,
    },
    count
  );
  console.log("Streams", JSON.stringify(streams, null, 2));
  return streams;
};
