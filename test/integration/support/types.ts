/** The parts of CLI and engine responses that the integration tests look at. */

export interface PingOutput {
  readonly url: string;
  readonly reachable: boolean;
  readonly version: string;
  readonly engines: readonly string[];
}

interface DefinitionRef {
  readonly id: string;
  readonly key: string;
  readonly resource: string;
}

export interface Deployment {
  readonly id: string;
  readonly name: string | null;
  readonly deployedProcessDefinitions: Readonly<Record<string, DefinitionRef>> | null;
  readonly deployedDecisionDefinitions: Readonly<Record<string, DefinitionRef>> | null;
}

export interface ProcessDefinition {
  readonly id: string;
  readonly key: string;
  readonly version: number;
}

export interface ProcessDefinitionXml {
  readonly id: string;
  readonly bpmn20Xml: string;
}

export interface ProcessInstance {
  readonly id: string;
  readonly businessKey: string | null;
  readonly ended: boolean;
}

export interface TypedValue {
  readonly type: string;
  readonly value: unknown;
}

export interface Task {
  readonly id: string;
  readonly name: string;
  readonly assignee: string | null;
}

export interface ExternalTask {
  readonly id: string;
  readonly topicName: string;
  readonly workerId: string;
  readonly processInstanceId: string;
}

export interface Incident {
  readonly id: string;
  readonly processInstanceId: string;
  readonly incidentType: string;
  readonly incidentMessage: string | null;
}

export interface Count {
  readonly count: number;
}

export interface DryRunOutput {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly curl: string;
}

export interface OutFileSummary {
  readonly outFile: string;
  readonly bytes: number;
  readonly contentType: string;
}
