import type { Request, Response, NextFunction } from "express";
import u from "@/utils";

export default function h3DesktopRequest(req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store").set("Pragma", "no-cache");
  const address = req.socket.remoteAddress ?? "";
  const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
  const localHost = req.hostname.toLowerCase() === "127.0.0.1";
  const requestOrigin = `http://${req.get("host")}`;
  const origin = req.get("origin");
  const referer = req.get("referer");
  const sameOrigin = origin !== undefined ? origin === requestOrigin : !!referer && referer.startsWith(`${requestOrigin}/`);
  if (!req.app.locals.desktop || !localAddress || !localHost || req.get("x-toonflow-desktop") !== "1" || !sameOrigin || u.mobileLink.isMobileLinkRequest(req)) {
    next(Object.assign(new Error("H3 Key 池只允许本机 Toonflow 桌面端管理"), { status: 403 }));
    return;
  }
  next();
}
