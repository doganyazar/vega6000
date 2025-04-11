import { select, input, Separator } from "@inquirer/prompts";
import { Vega6000StreamApi, type CGI } from "./Vega6000StreamApi";
import { Encode_Main, Encode_Double_Stereo } from "./scenarios";

let HOST = process.env.HOST;
let PASSWORD = process.env.PASSWORD;
let streamer!: Vega6000StreamApi;

// accept same input as streamer.inquiry
async function printInquiry(resources: CGI[]) {
  const response = await streamer.inquiry(resources);
  console.log(response);
}

const MainMenu = {
  reset: {
    title: "Disable all encode/decode/streams",
    action: () => streamer.reset(),
  },
  quit: {
    title: "Quit",
    action: () => process.exit(0),
  },
  "inquiry-streams": {
    title: "Inquiry streams",
    action: () => printInquiry(["av_input", "video", "encode", "stream"]),
  },
  "inquiry-video-input": {
    title: "Inquiry video input",
    action: () => printInquiry(["video_input_status"]),
  },
  "inquiry-system": {
    title: "Inquiry system",
    action: () => printInquiry(["system"]),
  },
};

const ScenarioMenu = {
  "test-suite-avc-main": {
    title: "Four H.264 15Mbps 4:2:2 10bit + four stereo aac_lc 64kbps for each",
    action: () => streamer.createStreams(Encode_Main(4, "h264")),
  },
  "test-suite-avc-double-stereo": {
    title:
      "Four H.264 15Mbps 4:2:2 10bit + for each stereo aac_lc 64kbps + four stereo ac3 32kbps",
    action: () => streamer.createStreams(Encode_Double_Stereo(4, "h264")),
  },
  "test-suite-avc-main-with-scte": {
    title: "Main scenario with SCTE-104 to SCTE-35",
    action: () => streamer.createStreams(Encode_Main(4, "h264", true)),
  },
  "test-suite-avc-single": {
    title: "Single H.264 15Mpbs 4:2:2 10bit aac_lc 64kbps",
    action: () => streamer.createStreams(Encode_Main(1, "h264")),
  },
  "test-suite-avc-single-with-scte": {
    title: "Single scenario with SCTE-104 to SCTE-35",
    action: () => streamer.createStreams(Encode_Main(1, "h264", true)),
  },
  "test-suite-hevc-main": {
    title: "Four H.265 15Mbps 4:2:2 10bit + four stereo aac_lc 64kbps for each",
    action: () => streamer.createStreams(Encode_Main(4, "h265")),
  },
  "test-suite-hevc-two-stereo": {
    title:
      "Four H.265 15Mbps 4:2:2 10bit + for each stereo aac_lc 64kbps + four stereo ac3 32kbps",
    action: () => streamer.createStreams(Encode_Double_Stereo(4, "h265")),
  },
  "test-suite-hevc-main-with-scte": {
    title: "Main scenario with SCTE-104 to SCTE-35",
    action: () => streamer.createStreams(Encode_Main(4, "h265", true)),
  },
  "test-suite-hevc-single": {
    title: "Single H.265 15Mpbs 4:2:2 10bit aac_lc 64kbps",
    action: () => streamer.createStreams(Encode_Main(1, "h265")),
  },
  "test-suite-hevc-single-with-scte": {
    title: "Single scenario with SCTE-104 to SCTE-35",
    action: () => streamer.createStreams(Encode_Main(1, "h265", true)),
  },
};

async function commandWithTimeout(op: Promise<any>, timeout = 30000) {
  await Promise.race([
    op.then(() => console.log("Command completed!\n")),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject("Command failed after timeout\n");
      }, timeout);
    }),
  ]).catch(console.error);
}

const ScenarioChoices = Object.entries(ScenarioMenu).map(([key, value]) => ({
  name: key,
  value: key,
  description: value.title,
  action: value.action,
}));

const MainMenuChoices = Object.entries(MainMenu).map(([key, value]) => ({
  name: key,
  value: key,
  description: value.title,
  action: value.action,
}));

const AllChoices = [...ScenarioChoices, ...MainMenuChoices];

let defaultChoice = "";

async function handleSelectMenu() {
  const answer = await select({
    message: `Select command (HOST: ${HOST})`,
    choices: [
      new Separator("-- Run Test suites --"),
      ...ScenarioChoices,
      new Separator("-- Commands --"),
      ...MainMenuChoices,
    ],
    loop: false,
    default: defaultChoice,
    pageSize: 25,
  });

  const chosen = AllChoices.find((choice) => choice.value === answer)!;
  await commandWithTimeout(chosen.action());

  // Set default choice to quit after first command
  defaultChoice = "quit";
  await handleSelectMenu();
}

async function handleMenu() {
  if (!HOST) {
    HOST = await input({ message: "Enter host", default: "127.0.0.1" });
  }

  if (!PASSWORD) {
    PASSWORD = await input({ message: "Enter password", default: "321321" });
  }

  streamer = new Vega6000StreamApi({
    baseUrl: `http://${HOST}`,
    auth: {
      username: "root",
      password: PASSWORD,
    },
  });

  return handleSelectMenu();
}

handleMenu().catch(console.error);

function exitHandler() {
  process.exit(0);
}

process.on("SIGINT", exitHandler);
process.on("exit", exitHandler);
