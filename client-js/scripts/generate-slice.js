const { compile } = require("slice2js");

const compiler = compile(
  [
    "../common/src/main/slice/ChessService.ice",
    "--output-dir",
    "src/services",
  ],
  { stdio: "inherit" },
);

compiler.on("error", (error) => {
  console.error("Could not start the Slice compiler:", error.message);
  process.exitCode = 1;
});

compiler.on("close", (code) => {
  process.exitCode = code;
});
