export default {
  id: "runningHubH3",
  label: "RunningHub MiniMax H3（本机 Key 池）",
  icon: "",
  version: "1.0.0",
  readme: "使用本机 RunningHub H3 加密 Key 池。Key 由本机服务保管；在「设置 → 媒体模型」打开 H3 Key 池管理后，可在视频生成节点选择 MiniMax H3。",
  rules: [],
  models: [{
    id: "MiniMax-H3",
    label: "MiniMax H3（文/图/视频/音频参考）",
    type: "video",
    mode: ["text", ["imageReference:6", "audioReference:3", "videoReference:1"]],
    audio: true,
    durationResolutionMap: [
      { duration: [5], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [6], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [7], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [8], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [9], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [10], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [11], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [12], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [13], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [14], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
      { duration: [15], resolution: ["0.4MP", "0.6MP", "0.9MP"] },
    ],
  }],
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const tool = this.tool.runningHubH3;
    if (!tool) throw new Error("本机 RunningHub H3 服务桥接不可用，请在 Toonflow 桌面版中使用此供应商");
    return tool.generateVideo(request);
  },
} satisfies ProviderDefinition;
