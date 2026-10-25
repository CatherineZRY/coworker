import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const alphabetId = customAlphabet(alphabet, 16);

export function newId(prefix: string): string {
  return `${prefix}_${alphabetId()}`;
}
