import {
  type ImageSize,
  type SDIPort,
  type StreamConfigInput,
  type VideoCodec,
} from "./Vega6000StreamApi";

const ENV_TARGET_IP = process.env.TARGET_IP;
const ENV_PORT_BEGIN = parseInt(process.env.PORT_BEGIN || "", 10);

interface MakeStreamOpts {
  id: SDIPort;
  video: {
    codec: VideoCodec;
    bitrate?: number;
    imageSize?: ImageSize;
  };
  audio: {
    codec: "aac_lc" | "ac3";
    bitrate?: number;
  }[];
  scte104To35Conversion?: boolean;
  targetIp?: string;
  protocol?: "udp" | "rtp";
  port: number;
}

function makeStream({
  id,
  video: { codec, bitrate = 15000, imageSize = "1280,720" },
  audio,
  scte104To35Conversion,
  targetIp = "127.0.0.1",
  protocol = "rtp",
  port,
}: MakeStreamOpts): StreamConfigInput {
  const audioConfig = audio.map(({ codec, bitrate = 64000 }) => ({
    codec,
    bitrate,
    sampleRate: 48000,
    pair: 1 as const,
  }));

  return {
    id,
    encoding: {
      video: {
        codec,
        bitrate,
        imageSize,
        pixelFormat: "XV20",
      },
      audio: audioConfig,
      scte104To35Conversion,
    },
    output: {
      url: `${protocol}://${targetIp}:${port}`,
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
}

export function Encode_Main(opts: EncodeScenarioOpts): StreamConfigInput[] {
  const {
    count,
    videoCodec,
    bitrate = 15000,
    imageSize = "1280,720",
    scte104To35Conversion,
  } = opts;
  const streams = makeSimilarStreams(
    {
      id: 1,
      video: {
        codec: videoCodec,
        bitrate,
        imageSize,
      },
      audio: [{ codec: "aac_lc" }],
      scte104To35Conversion,
      port: ENV_PORT_BEGIN || 4010,
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
  } = opts;
  const streams = makeSimilarStreams(
    {
      id: 1,
      video: {
        codec: videoCodec,
        bitrate,
        imageSize,
      },
      audio: [
        { codec: "aac_lc", bitrate: 64000 },
        { codec: "ac3", bitrate: 48000 },
      ],
      scte104To35Conversion,
      port: ENV_PORT_BEGIN || 4010,
    },
    count
  );
  console.log("Streams", JSON.stringify(streams, null, 2));
  return streams;
};
