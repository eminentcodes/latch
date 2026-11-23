import type { PermissionCheck } from './contract.js';

export type EngineName = 'kane' | 'local';
export type Verdict = 'passed' | 'failed' | 'incomplete';
export type VerificationInputs = {fixtureHash: string; scenarioHash: string; verifierHash: string};
export type Evidence = {kind: 'screenshot' | 'video' | 'trace' | 'kane-pack' | 'events'; path: string; label: string};
export type Observation = {
  caseTag: string;
  actor: string | null;
  resource: string;
  action: 'read' | 'update';
  status: number;
  disclosed: boolean;
  beforeHash: string;
  afterHash: string;
  at: string;
};
export type DriverResult = {
  engine: EngineName;
  state: 'passed' | 'failed' | 'error' | 'timeout';
  summary: string;
  durationMs: number;
  evidence: Evidence[];
  terminal: boolean;
  credits?: number;
  testUrl?: string;
};
export type CaseResult = {
  check: PermissionCheck;
  actorLabel: string;
  resourceLabel: string;
  verdict: Verdict;
  reason: string;
  driver: DriverResult;
  observation: Observation | null;
  controlId: string | null;
};
export type RunResult = {
  version: 1;
  id: string;
  name: string;
  engine: EngineName;
  startedAt: string;
  finishedAt: string;
  commit: string | null;
  contractHash: string;
  inputs: VerificationInputs;
  verdict: Verdict;
  cases: CaseResult[];
  expectedCases: number;
  baseUrl: string;
  mode: string;
  repair?: {
    method: 'local-patch' | 'codex';
    files: {path: string; beforeHash: string; afterHash: string}[];
    applied: boolean;
  };
};
