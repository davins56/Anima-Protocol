import { afterEach, describe, expect, it } from "vitest";
import {
  localLlmBackupBaseUrl,
  usableLocalLlmBackupBaseUrl,
} from "../src/lib/localLlmBackup";

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
});

describe("localLlmBackupBaseUrl", () => {
  it("is null when the backup variable is unset", () => {
    delete process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL;
    expect(localLlmBackupBaseUrl()).toBeNull();
    expect(
      usableLocalLlmBackupBaseUrl(
        process.env,
        "https://llm.anima-protocol.com/v1",
      ),
    ).toBeNull();
  });

  it("normalizes the planned backup origin onto /v1", () => {
    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL =
      "https://llm-backup.anima-protocol.com";
    expect(localLlmBackupBaseUrl()).toBe(
      "https://llm-backup.anima-protocol.com/v1",
    );
    expect(
      usableLocalLlmBackupBaseUrl(
        process.env,
        "https://llm.anima-protocol.com/v1",
      ),
    ).toBe("https://llm-backup.anima-protocol.com/v1");
  });

  it("rejects cloud flagship hosts so OpenAI cannot be a backup", () => {
    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL = "https://api.openai.com/v1";
    expect(localLlmBackupBaseUrl()).toBeNull();
    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL = "https://openrouter.ai/api/v1";
    expect(localLlmBackupBaseUrl()).toBeNull();
  });

  it("rejects a backup that is the same host as the primary", () => {
    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL =
      "https://llm.anima-protocol.com/v1";
    expect(
      usableLocalLlmBackupBaseUrl(
        process.env,
        "https://llm.anima-protocol.com/v1",
      ),
    ).toBeNull();
  });

  it("keeps a query string on the pathname and treats /V1 as versioned", () => {
    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL =
      "https://llm-backup.anima-protocol.com/proxy?token=x";
    expect(localLlmBackupBaseUrl()).toBe(
      "https://llm-backup.anima-protocol.com/proxy/v1?token=x",
    );

    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL =
      "https://llm-backup.anima-protocol.com/V1";
    expect(localLlmBackupBaseUrl()).toBe(
      "https://llm-backup.anima-protocol.com/V1",
    );
  });

  it("rejects loopback when the runtime is the Worker", () => {
    process.env.ANIMA_RUNTIME = "worker";
    process.env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL = "http://127.0.0.1:11434/v1";
    expect(localLlmBackupBaseUrl()).toBeNull();
  });
});
