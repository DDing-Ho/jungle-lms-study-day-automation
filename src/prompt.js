import readline from "node:readline";
import { END_STUDY_TIME_GUIDE_TEXT, END_STUDY_TIME_PROMPT, parseEndStudyTimeInput } from "./end-time.js";

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    const originalWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (value) => {
      if (rl.stdoutMuted) {
        rl.output.write("*");
        return;
      }

      originalWrite(value);
    };

    rl.stdoutMuted = true;
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptForGoogleEmail() {
  return ask("Google email: ");
}

export async function promptForGooglePassword() {
  return ask("Google password: ", { hidden: true });
}

export async function promptForEndStudyTime() {
  while (true) {
    const answer = await ask(END_STUDY_TIME_PROMPT);
    const parsed = parseEndStudyTimeInput(answer);
    if (parsed) {
      return parsed;
    }

    console.log(END_STUDY_TIME_GUIDE_TEXT);
  }
}
