const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "本机网关 API Key",
    value: "",
    props: {
      type: "password",
      showPassword: true,
      autocomplete: "off",
      placeholder: "填写 WorkBuddy2API 本机服务的 API Key",
    },
  },
];

export default {
  id: "workbuddyLocal" as const,
  label: "WorkBuddy（本机网关）",
  icon: "",
  version: "1.0.0",
  apiUrl: "http://127.0.0.1:7863/v1",
  protocol: "openai-completions",
  readme: [
    "连接本机运行的 WorkBuddy2API OpenAI 兼容网关。请先启动网关，再填写它的客户端 API Key；这不是 WorkBuddy 登录令牌。",
    "",
    "模型列表会从本机服务动态读取。默认地址为 `http://127.0.0.1:7863/v1`；端口不同或 Toonflow 运行在另一台机器时，请使用“自定义供应商”并配置正确地址。",
    "",
    "WorkBuddy2API 程序和个人配置由用户另行安装/保管，不随 Toonflow 发布。API Key 只用于网关认证，不会写入 Toonflow 源码；请确保服务只监听 `127.0.0.1`，不要将本机网关暴露到局域网。",
  ].join("\n"),
  rules,
  models: [],
} satisfies ProviderDefinition<typeof rules>;
