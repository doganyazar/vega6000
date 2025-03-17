standalone-linux-arm:
	bun build --compile --minify --sourcemap --target=bun-linux-arm64 ./cli.ts --outfile out/cli204

standalone:
	bun build --compile ./cli.ts --outfile out/cli204