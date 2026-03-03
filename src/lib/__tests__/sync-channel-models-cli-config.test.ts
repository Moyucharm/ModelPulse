import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    channel: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    channelKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    model: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    modelKeyword: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return { default: prismaMock };
});

import prisma from "@/lib/prisma";
import { syncChannelModels } from "@/lib/queue/service";

type MockedPrisma = {
  channel: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  model: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("syncChannelModels CLI config updates", () => {
  const mockedPrisma = prisma as unknown as MockedPrisma;

  beforeEach(() => {
    vi.clearAllMocks();

    mockedPrisma.channel.findUnique.mockResolvedValue({
      id: "channel-1",
      keyMode: "single",
    });
    mockedPrisma.model.findMany.mockResolvedValue([
      {
        id: "m1",
        modelName: "gpt-5.1",
        enableChatDetection: true,
        enableGeminiCliDetection: true,
        enableCodexDetection: true,
        enableClaudeDetection: true,
      },
      {
        id: "m2",
        modelName: "gpt-4o",
        enableChatDetection: true,
        enableGeminiCliDetection: true,
        enableCodexDetection: true,
        enableClaudeDetection: true,
      },
    ]);
    mockedPrisma.model.deleteMany.mockResolvedValue({ count: 0 });
    mockedPrisma.model.createMany.mockResolvedValue({ count: 0 });
    mockedPrisma.model.update.mockImplementation(async ({ where, data }) => ({
      id: where.id,
      ...data,
    }));
    mockedPrisma.$transaction.mockResolvedValue([]);
  });

  it("updates retained models when CLI switches change", async () => {
    const result = await syncChannelModels(
      "channel-1",
      ["gpt-5.1", "gpt-4o"],
      undefined,
      {
        "gpt-5.1": { chat: true, gemini: true, codex: false, claude: true },
        "gpt-4o": { chat: true, gemini: true, codex: true, claude: true },
      }
    );

    expect(result).toEqual({ added: 0, removed: 0, total: 2 });
    expect(mockedPrisma.model.createMany).not.toHaveBeenCalled();
    expect(mockedPrisma.model.update).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.model.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: {
        enableChatDetection: true,
        enableGeminiCliDetection: true,
        enableCodexDetection: false,
        enableClaudeDetection: true,
      },
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("defaults missing chat switch to true", async () => {
    mockedPrisma.model.findMany.mockResolvedValue([
      {
        id: "m1",
        modelName: "gpt-4o",
        enableChatDetection: false,
        enableGeminiCliDetection: true,
        enableCodexDetection: true,
        enableClaudeDetection: true,
      },
    ]);

    await syncChannelModels(
      "channel-1",
      ["gpt-4o"],
      undefined,
      {
        "gpt-4o": { gemini: true, codex: true, claude: true },
      }
    );

    expect(mockedPrisma.model.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: {
        enableChatDetection: true,
        enableGeminiCliDetection: true,
        enableCodexDetection: true,
        enableClaudeDetection: true,
      },
    });
  });
});
