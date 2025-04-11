import {
  type ImageSize,
  type SDIPort,
  type StreamConfigInput,
  type VideoCodec,
} from "./Vega6000StreamApi";

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
  rtpPort: number;
}

function makeStream({
  id,
  video: { codec, bitrate = 15000, imageSize = "1280,720" },
  audio,
  scte104To35Conversion,
  rtpPort,
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
      url: `rtp://127.0.0.1:${rtpPort}`,
    },
  };
}

function makeSimilarStreams(opts: MakeStreamOpts, count: number) {
  return Array.from({ length: count }, (_, i) => {
    return makeStream({
      ...opts,
      id: (i + 1) as SDIPort,
      rtpPort: opts.rtpPort + i * 10,
    });
  });
}

export function Encode_Main(
  count: number,
  videoCodec: VideoCodec,
  scte104To35Conversion?: boolean
): StreamConfigInput[] {
  const streams = makeSimilarStreams(
    {
      id: 1,
      video: {
        codec: videoCodec,
        bitrate: 15000,
        imageSize: "1280,720",
      },
      audio: [{ codec: "aac_lc" }],
      scte104To35Conversion,
      rtpPort: 4010,
    },
    count
  );
  console.log("Streams", JSON.stringify(streams, null, 2));
  return streams;
}

export const Encode_Double_Stereo = (
  count: number,
  videoCodec: VideoCodec,
  scte104To35Conversion?: boolean
): StreamConfigInput[] => {
  const streams = makeSimilarStreams(
    {
      id: 1,
      video: {
        codec: videoCodec,
        bitrate: 15000,
        imageSize: "1280,720",
      },
      audio: [
        { codec: "aac_lc", bitrate: 64000 },
        { codec: "ac3", bitrate: 48000 },
      ],
      scte104To35Conversion,
      rtpPort: 4010,
    },
    count
  );
  console.log("Streams", JSON.stringify(streams, null, 2));
  return streams;
};
