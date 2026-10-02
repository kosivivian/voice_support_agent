// Per-turn latency breakdown. All times are ms since the Vapi request arrived.
export interface PassTiming {
  start: number;
  firstOutput: number | null;
  thinkingMs: number;
  outputTokens: number;
  inputTokens: number;
  end: number | null;
}

export interface ToolTiming {
  name: string;
  modelEmitted: number;
  started: number | null;
  finished: number | null;
}

export class TurnTimer {
  readonly t0 = Date.now();
  marks: Record<string, number> = {};
  passes: PassTiming[] = [];
  tools: ToolTiming[] = [];
  warm: boolean | null = null;
  private thinkingSince: number | null = null;

  now(): number {
    return Date.now() - this.t0;
  }

  mark(name: string) {
    this.marks[name] ??= this.now();
  }

  passStart(inputTokens: number) {
    this.passes.push({ start: this.now(), firstOutput: null, thinkingMs: 0, outputTokens: 0, inputTokens, end: null });
  }

  private get pass(): PassTiming | undefined {
    return this.passes[this.passes.length - 1];
  }

  output() {
    const p = this.pass;
    if (p && p.firstOutput === null) p.firstOutput = this.now();
  }

  thinkingStart() {
    this.output();
    this.thinkingSince = this.now();
  }

  blockStop() {
    if (this.thinkingSince !== null && this.pass) this.pass.thinkingMs += this.now() - this.thinkingSince;
    this.thinkingSince = null;
  }

  passEnd(outputTokens: number) {
    const p = this.pass;
    if (p) {
      p.end = this.now();
      p.outputTokens = outputTokens;
    }
  }

  toolEmitted(name: string): ToolTiming {
    const t: ToolTiming = { name, modelEmitted: this.now(), started: null, finished: null };
    this.tools.push(t);
    return t;
  }

  summary() {
    const toolMs = this.tools.reduce((n, t) => n + (t.finished !== null && t.started !== null ? t.finished - t.started : 0), 0);
    return {
      total_ms: this.now(),
      warm: this.warm,
      marks: this.marks,
      passes: this.passes.map((p) => ({
        ttft_ms: p.firstOutput !== null ? p.firstOutput - p.start : null,
        dur_ms: p.end !== null ? p.end - p.start : null,
        thinking_ms: p.thinkingMs,
        in_tok: p.inputTokens,
        out_tok: p.outputTokens,
      })),
      tools: this.tools.map((t) => ({
        name: t.name,
        exec_ms: t.finished !== null && t.started !== null ? t.finished - t.started : null,
        wait_after_emit_ms: t.started !== null ? t.started - t.modelEmitted : null,
      })),
      tool_ms: toolMs,
    };
  }
}
