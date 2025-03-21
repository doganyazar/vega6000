import { select, input, Separator } from "@inquirer/prompts";
import { StreamAPI } from "./StreamApi";
import { Encode_Main, Encode_Double_Stereo } from "./scenarios";

let HOST = process.env.HOST;
let PASSWORD = process.env.PASSWORD;
let streamer!: StreamAPI;

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
    action: () => streamer.inquiry(["av_input", "video", "encode", "stream"]),
  },
  "inquiry-system": {
    title: "Inquiry system",
    action: () => streamer.inquiry(["system"]),
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
  "test-suite-avc-single": {
    title: "Single H.264 15Mpbs 4:2:2 10bit aac_lc 64kbps",
    action: () => streamer.createStreams(Encode_Main(1, "h264")),
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
  "test-suite-hevc-single": {
    title: "Single H.265 15Mpbs 4:2:2 10bit aac_lc 64kbps",
    action: () => streamer.createStreams(Encode_Main(1, "h265")),
  },
};

async function commandWithTimeout(op: Promise<any>, timeout = 10000) {
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
    pageSize: 10,
  });

  const chosen = AllChoices.find((choice) => choice.value === answer)!;
  await commandWithTimeout(chosen.action());

  await handleSelectMenu();
}

async function handleMenu() {
  if (!HOST) {
    HOST = await input({ message: "Enter host", default: "127.0.0.1" });
  }

  if (!PASSWORD) {
    PASSWORD = await input({ message: "Enter password", default: "321321" });
  }

  streamer = new StreamAPI({
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
