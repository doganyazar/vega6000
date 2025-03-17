import { type ImageSize, type SDIPort, type StreamConfigInput, type VideoCodec } from './StreamApi'

interface MakeStreamOpts {
    id: SDIPort
    video: {
        codec: VideoCodec
        bitrate?: number
        imageSize?: ImageSize
    }
    audio: {
        codec: 'aac_lc' | 'ac3'
        bitrate?: number
    }[]
    rtpPort: number
}

function makeStream({
    id,
    video: { codec, bitrate = 15000, imageSize = '1280,720' },
    audio,
    rtpPort,
}: MakeStreamOpts): StreamConfigInput {
    const audioConfig = audio.map(({ codec, bitrate = 64000 }) => ({
        codec,
        bitrate,
        sampleRate: 48000,
        pair: 1 as const,
    }))

    return {
        id,
        encoding: {
            video: {
                codec,
                bitrate,
                imageSize,
                pixelFormat: 'XV20',
            },
            audio: audioConfig,
        },
        output: {
            url: `rtp://127.0.0.1:${rtpPort}`,
        },
    }
}

function makeSimilarStreams(opts: MakeStreamOpts, count: number) {
    return Array.from({ length: count }, (_, i) => {
        return makeStream({
            ...opts,
            id: (i + 1) as SDIPort,
            rtpPort: opts.rtpPort + i * 10,
        })
    })
}

export function Encode_Main(count: number, videoCodec: VideoCodec): StreamConfigInput[] {
    const streams = makeSimilarStreams(
        {
            id: 1,
            video: {
                codec: videoCodec,
                bitrate: 15000,
                imageSize: '1280,720',
            },
            audio: [{ codec: 'aac_lc' }],
            rtpPort: 4010,
        },
        count
    )
    console.log('Streams', streams)
    return streams
}

export const Encode_Double_Stereo = (count: number, videoCodec: VideoCodec): StreamConfigInput[] => {
    const streams = makeSimilarStreams(
        {
            id: 1,
            video: {
                codec: videoCodec,
                bitrate: 15000,
                imageSize: '1280,720',
            },
            audio: [
                { codec: 'aac_lc', bitrate: 64000 },
                { codec: 'ac3', bitrate: 48000 },
            ],
            rtpPort: 4010,
        },
        count
    )
    console.log('Streams', streams)
    return streams
}
