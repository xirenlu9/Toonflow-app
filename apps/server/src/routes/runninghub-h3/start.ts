import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import h3DesktopRequest from "@/lib/h3DesktopRequest";
import { error, success } from "@/lib/responseFormat";

export default Router().post("/", h3DesktopRequest, async (req, res) => {
  if (!z.strictObject({}).safeParse(req.body ?? {}).success) return res.status(400).json(error("启动本机服务不接受额外参数"));
  const start = u.desktop.getDesktopRuntime(req).startRunningHubH3Service;
  if (!start) return res.status(501).json(error("当前桌面平台不支持自动启动 H3 服务，请在本机启动 Skill 服务"));
  await start();
  res.json(success({ started: true }));
});
