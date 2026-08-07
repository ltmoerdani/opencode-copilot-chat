import type { LanguageModelResponsePart2, Progress } from "vscode";
import type { UsageSnapshot } from "./usage";

type ContextWindowHookModule = typeof import("./contextWindowHook.js");

let loadedContextWindowHookModule: ContextWindowHookModule | null = null;
let loadingContextWindowHookModule: Promise<ContextWindowHookModule | null> | undefined;

let reportUsageImpl = (_localRequestId: string, _usage: UsageSnapshot): boolean => false;
let reportProgressImpl = (
  _localRequestId: string,
  progress: Progress<LanguageModelResponsePart2>,
  part: LanguageModelResponsePart2,
): void => {
  progress.report(part);
};
let clearRequestImpl = (_localRequestId: string): void => {};
let setOutputBufferImpl = (_localRequestId: string, _outputBuffer: number): void => {};

function installNoopImplementations(): void {
  reportUsageImpl = (_localRequestId: string, _usage: UsageSnapshot): boolean => false;
  reportProgressImpl = (
    _localRequestId: string,
    progress: Progress<LanguageModelResponsePart2>,
    part: LanguageModelResponsePart2,
  ): void => {
    progress.report(part);
  };
  clearRequestImpl = (_localRequestId: string): void => {};
  setOutputBufferImpl = (_localRequestId: string, _outputBuffer: number): void => {};
}

function installHookImplementations(hookModule: ContextWindowHookModule): void {
  reportUsageImpl = hookModule.reportUsageToContextWindowForRequest;
  reportProgressImpl = hookModule.reportProgressWithContextWindowRequest;
  clearRequestImpl = hookModule.clearContextWindowRequest;
  setOutputBufferImpl = hookModule.setContextWindowOutputBufferForRequest;
}

async function loadContextWindowHookModule(logDiagnostic?: (message: string) => void): Promise<ContextWindowHookModule | null> {
  if (loadedContextWindowHookModule) {
    return loadedContextWindowHookModule;
  }

  if (!loadingContextWindowHookModule) {
    loadingContextWindowHookModule = import("./contextWindowHook.js")
      .then((hookModule) => {
        loadedContextWindowHookModule = hookModule;
        return hookModule;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logDiagnostic?.(`contextWindowHook: failed to import hook module — ${message}`);
        loadingContextWindowHookModule = undefined;
        return null;
      });
  }

  const hookModule = await loadingContextWindowHookModule;
  loadingContextWindowHookModule = undefined;
  return hookModule;
}

export function reportUsageToContextWindowForRequest(localRequestId: string, usage: UsageSnapshot): boolean {
  return reportUsageImpl(localRequestId, usage);
}

export function reportProgressWithContextWindowRequest(
  localRequestId: string,
  progress: Progress<LanguageModelResponsePart2>,
  part: LanguageModelResponsePart2,
): void {
  reportProgressImpl(localRequestId, progress, part);
}

export function clearContextWindowRequest(localRequestId: string): void {
  clearRequestImpl(localRequestId);
}

export function setContextWindowOutputBufferForRequest(localRequestId: string, outputBuffer: number): void {
  setOutputBufferImpl(localRequestId, outputBuffer);
}

export async function initializeContextWindowHookBridge(logDiagnostic?: (message: string) => void): Promise<boolean> {
  const hookModule = await loadContextWindowHookModule(logDiagnostic);
  if (!hookModule) {
    installNoopImplementations();
    logDiagnostic?.("contextWindowHook: bridge staying in no-op mode (module not available)");
    return false;
  }

  const success = await hookModule.initializeContextWindowHook(logDiagnostic);
  if (success) {
    installHookImplementations(hookModule);
    logDiagnostic?.("contextWindowHook: bridge active — usage will be injected into the Copilot Chat footer");
  } else {
    installNoopImplementations();
    logDiagnostic?.("contextWindowHook: bridge staying in no-op mode (proxy capture failed or config changed)");
  }

  return success;
}

export async function disposeContextWindowHookBridge(): Promise<boolean> {
  installNoopImplementations();

  if (!loadedContextWindowHookModule) {
    return false;
  }

  return loadedContextWindowHookModule.disposeContextWindowHook();
}

installNoopImplementations();
