import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import {
  getNotificationConfigView,
  updateNotificationConfig,
} from "@/lib/notifications/config";

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const config = await getNotificationConfigView();
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json(
      { error: "获取通知配置失败", code: "FETCH_ERROR" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const config = await updateNotificationConfig(body);
    return NextResponse.json({
      success: true,
      config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存通知配置失败";
    return NextResponse.json(
      { error: message, code: "UPDATE_ERROR" },
      { status: 400 },
    );
  }
}
