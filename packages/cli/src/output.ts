import process from 'node:process';

export class Output {
  json: boolean;

  constructor(json: boolean) {
    this.json = json;
  }

  data(value: unknown): void {
    if (!this.json) return;
    process.stdout.write(`${JSON.stringify(value ?? null, null, 2)}\n`);
  }

  line(text: string): void {
    if (this.json) return;
    process.stdout.write(`${text}\n`);
  }

  raw(text: string): void {
    process.stdout.write(`${text}\n`);
  }
}
