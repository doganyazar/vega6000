# vega6000

This is a CLI tool to interact with the Vega 6000 CGI API and run test scenarios.

## Setup
Bun is recommended to run this project. To install Bun, check out the [Bun website](https://bun.sh/docs/installation#installing), or run the following command:

```bash
npm install -g bun
```

To install dependencies:

```bash
bun install
```

## Usage
Copy .env.sample as .env and set environment variables accordingly.

To run CLI:

```bash
bun run cli.ts
```

Can set environment variables in the command line as well:

```bash
HOST=10.101.200.201 bun run cli.ts
```

## Run with Node.js
It is possible to run it with Node >= v22 as well if installing bun is not preferred:

```bash
npm install
# set desired host below
HOST=10.101.200.201 npm run dev-node
```