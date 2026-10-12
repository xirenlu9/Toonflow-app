<template>
  <el-dialog
    v-model="visible"
    title="RunningHub MiniMax H3 · Key 池管理"
    width="min(1060px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="!busy"
    :closeOnPressEscape="!busy"
    :showClose="!busy"
    @closed="resetTransientState">
    <div class="h3Manager">
      <el-alert v-if="!overview?.service.online" type="warning" :closable="false" showIcon title="本机 H3 服务未连接">
        <template #default>
          <p>Windows 桌面启动时会尝试启动本机 H3 服务，并复用已配置的免口令解锁机制。服务令牌不会发送到网页；若持续离线，请确认 Node.js 20+ 和 runninghub-minimax-h3 Skill 已安装。已有手动口令 Vault 仍需使用原口令启动，不会覆盖现有数据。</p>
        </template>
      </el-alert>
      <el-alert v-else-if="overview.executor.paused" type="warning" :closable="false" showIcon :title="executorStateLabel">
        <template #default>{{ overview.executor.reason ? `原因：${overview.executor.reason}` : "当前不会提交新的 H3 任务。" }}</template>
      </el-alert>
      <el-alert v-if="errorText" type="error" :closable="false" showIcon :title="errorText" />

      <el-tabs v-model="activeTab" class="h3Tabs" @tabChange="onTabChange">
        <el-tab-pane label="总览" name="overview">
          <div class="overviewGrid">
            <el-card shadow="never">
              <template #header><div class="sectionHeading"><strong>服务与执行器</strong><el-button text :loading="loading" @click="loadOverview">刷新</el-button></div></template>
              <div class="statusRows">
                <div><span>本机服务</span><el-tag :type="overview?.service.online ? 'success' : 'danger'" size="small">{{ overview?.service.online ? "在线" : "离线" }}</el-tag></div>
                <div><span>执行器</span><el-tag :type="executorTagType" size="small">{{ overview ? executorStateLabel : "未知" }}</el-tag></div>
                <div><span>正在处理</span><strong>{{ overview?.executor.activeTasks ?? "—" }}</strong></div>
                <div><span>并发上限</span><strong>{{ overview?.settings.maxConcurrent ?? "—" }}</strong></div>
                <div><span>Key 总数</span><strong>{{ overview?.keys.length ?? "—" }}</strong></div>
                <div><span>已启用</span><strong>{{ enabledKeyCount }}</strong></div>
              </div>
              <div class="overviewActions">
                <el-button type="warning" :disabled="!overview?.service.online || !overview.executor.canControl || overview.executor.paused || !!busy" :loading="busy === 'pause'" @click="setExecutor('pause')">暂停执行器</el-button>
                <el-button type="success" :disabled="!overview?.service.online || !overview.executor.canControl || !overview.executor.paused || !!busy" :loading="busy === 'resume'" @click="setExecutor('resume')">恢复执行器</el-button>
              </div>
            </el-card>
            <el-card shadow="never">
              <template #header><strong>固定模型</strong></template>
              <el-tag type="primary">MiniMax H3</el-tag>
              <p class="muted">H3 是 Toonflow 内置视频模型，通过本机执行器和 Key 池调度。此处不设置供应商 API Key。</p>
              <p class="muted">余额仅逐 Key 展示，不按账号组重复求和；最低积分是调度门槛，不代表单条视频费用。</p>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="Key 池" name="keys">
          <div class="keyTools">
            <el-card shadow="never" class="addKeyCard">
              <template #header><strong>添加单个消费级 Key</strong></template>
              <el-form labelPosition="top" @submit.prevent>
                <el-form-item label="消费级 API Key">
                  <el-input v-model="singleKey" type="password" showPassword autocomplete="off" placeholder="32 位十六进制；不会显示在列表中" :disabled="!overview?.service.online || !!busy" />
                </el-form-item>
                <el-form-item label="匿名账号组">
                  <el-select v-model="selectedGroup" class="fullWidth" :disabled="!!busy">
                    <el-option label="新建匿名账号组" value="__new__" />
                    <el-option v-for="group in accountGroups" :key="group" :label="groupLabel(group)" :value="group" />
                  </el-select>
                </el-form-item>
                <el-button type="primary" :loading="busy === 'add-key'" :disabled="!overview?.service.online || !!busy || !/^[a-fA-F0-9]{32}$/.test(singleKey.trim())" @click="addSingleKey">加入 Key 池</el-button>
                <el-text class="hint" type="info" size="small">新 Key 默认禁用；添加不会探测余额或创建视频任务。</el-text>
              </el-form>
            </el-card>
            <el-card shadow="never" class="importCard">
              <template #header><strong>从 TXT 导入</strong></template>
              <p class="muted">支持格式：邮箱----RunningHub 密码----旧积分----消费级 Key----邮箱密码。仅在本机解析；密码、邮箱和旧积分不会上传或保存。</p>
              <input ref="fileInput" type="file" accept=".txt,text/plain" hidden :disabled="!!busy" @change="readImportFile" />
              <el-button :icon="IconFileImport" :disabled="!overview?.service.online || !!busy" @click="fileInput?.click()">选择 TXT 并预览</el-button>
              <el-text v-if="fileName" class="fileName" type="info" size="small">{{ fileName }}</el-text>
              <el-text class="hint" type="info" size="small">最多 1 MB、100 个不同 Key。导入只入池且默认禁用，不探测、不启用、不创建任务。</el-text>
            </el-card>
          </div>

          <el-card v-if="preview" shadow="never" class="previewCard">
            <template #header>
              <div class="sectionHeading"><strong>导入预览</strong><el-button text type="danger" @click="clearPreview">清除</el-button></div>
            </template>
            <p class="muted">有效 {{ preview.entries.length }} 条 · {{ preview.accountGroupCount }} 个匿名账号组 · 重复跳过 {{ preview.duplicateCount }} 条 · 错误 {{ preview.failures.length }} 条</p>
            <el-table :data="preview.entries" maxHeight="220" size="small">
              <el-table-column prop="line" label="行" width="70" />
              <el-table-column label="匿名账号组" minWidth="180"><template #default="scope">{{ groupLabel(scope.row.accountGroup) }}</template></el-table-column>
              <el-table-column label="消费级 Key" minWidth="150"><template #default="scope">••••{{ scope.row.apiKey.slice(-4) }}</template></el-table-column>
              <el-table-column label="状态" width="110"><template #default><el-tag size="small" type="info">导入后禁用</el-tag></template></el-table-column>
            </el-table>
            <el-table v-if="preview.failures.length" :data="preview.failures" class="failureTable" maxHeight="170" size="small">
              <el-table-column prop="line" label="错误行" width="90" />
              <el-table-column prop="reason" label="原因" />
            </el-table>
            <el-button class="importConfirm" type="primary" :loading="busy === 'import'" :disabled="!preview.entries.length || !overview?.service.online || !!busy" @click="confirmImport">确认导入（不生成视频）</el-button>
          </el-card>

          <el-card shadow="never" class="keysCard">
            <template #header><div class="sectionHeading"><strong>池内 Key</strong><el-button text :loading="loading" @click="loadOverview">刷新余额与状态</el-button></div></template>
            <el-table v-loading="loading" :data="keys" rowKey="keyId" emptyText="尚未导入 Key">
              <el-table-column label="匿名账号组" minWidth="150"><template #default="scope">{{ groupLabel(scope.row.accountGroup) }}</template></el-table-column>
              <el-table-column label="Key 状态" minWidth="120"><template #default="scope"><el-tag size="small" :type="keyTagType(scope.row as H3Key)">{{ keyStateLabel(scope.row as H3Key) }}</el-tag></template></el-table-column>
              <el-table-column label="余额（逐 Key）" minWidth="150"><template #default="scope">{{ balanceLabel(scope.row as H3Key) }}</template></el-table-column>
              <el-table-column label="账号任务数" width="110"><template #default="scope">{{ scope.row.accountStatus?.currentTaskCount ?? "未知" }}</template></el-table-column>
              <el-table-column label="最近探测" minWidth="150"><template #default="scope">{{ formatDate(scope.row.accountStatus?.checkedAt) }}</template></el-table-column>
              <el-table-column label="操作" minWidth="190" fixed="right">
                <template #default="scope">
                  <el-button link type="primary" :loading="busy === `probe:${scope.row.keyId}`" :disabled="!overview?.service.online || !!busy" @click="probeKey(scope.row as H3Key)">探测余额</el-button>
                  <el-button link :type="scope.row.enabled ? 'warning' : 'success'" :disabled="!overview?.service.online || !!busy || (!scope.row.enabled && scope.row.consumerStatus !== 'consumer')" @click="toggleKey(scope.row as H3Key)">{{ scope.row.enabled ? "停用" : "启用" }}</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-text class="hint" type="info" size="small">服务不提供删除 Key；可停用以保留任务账本和历史关联。新导入 Key 探测通过后仍需手动启用；此前已手动启用但探测失败的 Key，服务可能在复测成功后恢复原启用状态。</el-text>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="调度设置" name="scheduler">
          <el-card shadow="never" class="schedulerCard">
            <template #header><strong>本机执行器调度</strong></template>
            <el-form labelPosition="top" class="schedulerForm" @submit.prevent>
              <el-form-item label="全局并发上限">
                <el-input-number v-model="scheduler.maxConcurrent" :min="1" :max="4" :step="1" :disabled="!overview?.service.online || overview.settings.maxConcurrent === null || !!busy" />
                <el-text class="hint" type="info" size="small">{{ overview?.settings.maxConcurrent == null ? "当前 H3 Skill 版本不提供并发设置接口。" : "服务限制为 1–4；每个匿名账号组同一时刻最多一个活动任务。" }}</el-text>
              </el-form-item>
              <el-form-item label="最低实时积分">
                <el-input-number v-model="scheduler.minCredits" :min="0.01" :max="1e12" :precision="2" :step="1" :disabled="!overview?.service.online || overview.settings.minCredits === null || !!busy" />
                <el-text class="hint" type="info" size="small">{{ overview?.settings.minCredits == null ? "当前 H3 Skill 版本不提供最低积分设置接口。" : "余额低于此值时不调度；这不是单条视频的费用估算。" }}</el-text>
              </el-form-item>
              <el-button type="primary" :loading="busy === 'settings'" :disabled="!overview?.service.online || overview.settings.maxConcurrent === null || overview.settings.minCredits === null || !!busy || !settingsChanged" @click="saveScheduler">保存调度设置</el-button>
              <el-divider />
              <div class="executorControls">
                <div><strong>执行器：{{ overview ? executorStateLabel : "未知" }}</strong><p class="muted">{{ overview?.executor.canControl ? "暂停仅阻止新的本机提交；正在跟踪的任务仍按原账号和任务 ID 继续查询。" : "当前 H3 Skill 版本不提供执行器暂停或恢复接口。" }}</p></div>
                <el-button v-if="!overview?.executor.paused" type="warning" :loading="busy === 'pause'" :disabled="!overview?.service.online || !overview.executor.canControl || !!busy" @click="setExecutor('pause')">暂停执行器</el-button>
                <el-button v-else type="success" :loading="busy === 'resume'" :disabled="!overview?.service.online || !overview.executor.canControl || !!busy" @click="setExecutor('resume')">恢复执行器</el-button>
              </div>
            </el-form>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="任务与用量" name="jobs">
          <el-card shadow="never" class="jobsCard">
            <template #header><div class="sectionHeading"><strong>最近任务（最多 100 条）</strong><el-button text :loading="loading" @click="loadOverview">刷新</el-button></div></template>
            <el-table v-loading="loading" :data="jobs" rowKey="id" emptyText="暂无 H3 任务">
              <el-table-column label="时间" minWidth="160"><template #default="scope">{{ formatDate(scope.row.createdAt) }}</template></el-table-column>
              <el-table-column prop="status" label="状态" minWidth="140" />
              <el-table-column label="参数" minWidth="160"><template #default="scope">{{ jobParameters(scope.row as H3Job) }}</template></el-table-column>
              <el-table-column label="RunningHub 积分" minWidth="150"><template #default="scope">{{ usageValue(scope.row.usage.rhCoins, "积分") }}</template></el-table-column>
              <el-table-column label="平台费用" minWidth="150"><template #default="scope">{{ platformCost(scope.row.usage) }}</template></el-table-column>
              <el-table-column prop="waitReason" label="等待原因" minWidth="160" showOverflowTooltip />
            </el-table>
            <el-text class="hint" type="info" size="small">平台未返回费用时显示“未知”，不估算；任务结果链接与输出不在此页面返回。</el-text>
          </el-card>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconFileImport } from "@tabler/icons-vue";
import { parseH3KeyImport, type H3ImportPreview } from "./h3KeyImport";

type H3AccountStatus = { remainCoins: number | null; remainMoney: number | null; currency: string | null; currentTaskCount: number | null; checkedAt: string | null };
type H3Key = { keyId: string; accountGroup: string; enabled: boolean; consumerStatus: string; accountStatus: H3AccountStatus | null; createdAt: string | null; lastUsedAt: number | null; availableAfter: number | null };
type H3Usage = { rhCoins: number | null; walletAmount: number | null; thirdPartyAmount: number | null; currency: string | null };
type H3Job = { id: string; status: string; taskId: string | null; keyId: string | null; accountGroup: string | null; parameters: { durationSeconds: number | null; aspectRatio: string | null; megapixels: number | null }; usage: H3Usage; waitReason: string | null; hasError: boolean; createdAt: string | null; updatedAt: string | null };
type H3Overview = {
  service: { online: boolean; executor: string };
  executor: { paused: boolean; reason: string | null; storageBlocked: boolean; canControl: boolean; activeTasks: number };
  settings: { maxConcurrent: number | null; minCredits: number | null };
  keys: H3Key[];
  jobs: H3Job[];
};
type ApiEnvelope<T> = { code: number; data: T | null; message: string };

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ updated: [] }>();
const activeTab = ref("overview");
const overview = ref<H3Overview>();
const loading = ref(false);
const busy = ref("");
const errorText = ref("");
const singleKey = ref("");
const selectedGroup = ref("__new__");
const fileInput = ref<HTMLInputElement>();
const fileName = ref("");
const preview = ref<H3ImportPreview>();
const scheduler = ref({ maxConcurrent: 3, minCredits: 1 });

const accountGroups = computed(() => [...new Set((overview.value?.keys ?? []).map(key => key.accountGroup))].sort());
const keys = computed<H3Key[]>(() => overview.value?.keys ?? []);
const jobs = computed<H3Job[]>(() => overview.value?.jobs ?? []);
const enabledKeyCount = computed(() => overview.value?.keys.filter(key => key.enabled).length ?? 0);
const settingsChanged = computed(() => !!overview.value && overview.value.settings.maxConcurrent !== null && overview.value.settings.minCredits !== null
  && (scheduler.value.maxConcurrent !== overview.value.settings.maxConcurrent || scheduler.value.minCredits !== overview.value.settings.minCredits));
const executorStateLabel = computed(() => {
  if (!overview.value) return "未知";
  if (!overview.value.service.online) return "服务离线";
  if (overview.value.executor.storageBlocked || overview.value.service.executor === "blocked") return "存储异常，已阻止";
  if (overview.value.executor.paused || overview.value.service.executor === "paused") return "已暂停";
  return "运行中";
});
const executorTagType = computed<"danger" | "warning" | "success">(() => !overview.value?.service.online || overview.value.executor.storageBlocked ? "danger" : overview.value.executor.paused ? "warning" : "success");

watch(visible, value => {
  if (!value) return;
  activeTab.value = "overview";
  errorText.value = "";
  void loadOverview();
}, { immediate: true });

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) return error.response?.data?.message || error.message || "本机 H3 管理请求失败";
  return error instanceof Error ? error.message : "本机 H3 管理请求失败";
}

async function request<T>(method: "get" | "post" | "patch", path: string, body?: unknown): Promise<T> {
  const response = await axios.request<ApiEnvelope<T>>({ method, url: `/api/runninghub-h3${path}`, data: body, timeout: 20000, headers: { "x-toonflow-desktop": "1", "Cache-Control": "no-store", Pragma: "no-cache" } });
  if (response.data.code !== 200 || response.data.data === null) throw new Error(response.data.message || "本机 H3 服务请求失败");
  return response.data.data;
}

async function loadOverview() {
  loading.value = true;
  errorText.value = "";
  try {
    overview.value = await request<H3Overview>("get", "/overview");
    scheduler.value = {
      maxConcurrent: overview.value.settings.maxConcurrent ?? 3,
      minCredits: overview.value.settings.minCredits ?? 1,
    };
  } catch (error) {
    overview.value = undefined;
    errorText.value = errorMessage(error);
  } finally { loading.value = false; }
}

function onTabChange() {
  if (!overview.value || !overview.value.service.online) void loadOverview();
}

function groupLabel(group: string) { return `匿名组 · ${group.slice(-8)}`; }
function formatDate(value: string | null | undefined) {
  if (!value) return "未探测";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString();
}
function keyStateLabel(key: H3Key) {
  if (key.consumerStatus === "ineligible") return key.enabled ? "资格不符" : "资格不符 / 已停用";
  if (key.consumerStatus !== "consumer") return "未探测";
  return key.enabled ? "已启用" : "已验证 / 停用";
}
function keyTagType(key: H3Key) {
  if (key.consumerStatus === "ineligible") return "danger";
  if (key.enabled && key.consumerStatus === "consumer") return "success";
  return "info";
}
function balanceLabel(key: H3Key) {
  const status = key.accountStatus;
  if (status?.remainCoins !== null && status?.remainCoins !== undefined) return `${status.remainCoins.toLocaleString()} 积分`;
  if (status?.remainMoney !== null && status?.remainMoney !== undefined) return `${status.remainMoney.toLocaleString()}${status.currency ? ` ${status.currency}` : ""}`;
  return "未知";
}
function jobParameters(job: H3Job) {
  const parts = [job.parameters.durationSeconds ? `${job.parameters.durationSeconds}s` : "", job.parameters.aspectRatio ?? "", job.parameters.megapixels ? `${job.parameters.megapixels}MP` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}
function usageValue(value: number | null, unit: string) { return value === null ? "未知" : `${value.toLocaleString()} ${unit}`; }
function platformCost(usage: H3Usage) {
  const currency = usage.currency ? ` ${usage.currency}` : "";
  const wallet = usage.walletAmount === null ? "未知" : `${usage.walletAmount.toLocaleString()}${currency}`;
  const thirdParty = usage.thirdPartyAmount === null ? "未知" : `${usage.thirdPartyAmount.toLocaleString()}${currency}`;
  return `钱包 ${wallet} · 第三方 ${thirdParty}`;
}

async function mutate(label: string, operation: () => Promise<unknown>, successText: string) {
  if (busy.value) return;
  busy.value = label;
  errorText.value = "";
  try {
    await operation();
    await loadOverview();
    emit("updated");
    ElMessage.success(successText);
  } catch (error) {
    const message = errorMessage(error);
    await loadOverview();
    errorText.value = message;
    emit("updated");
  } finally { busy.value = ""; }
}

function newAnonymousGroup() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `acct_manual_${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function addSingleKey() {
  const apiKey = singleKey.value.trim();
  if (!/^[a-fA-F0-9]{32}$/.test(apiKey)) return;
  const accountGroup = selectedGroup.value === "__new__" ? newAnonymousGroup() : selectedGroup.value;
  await mutate("add-key", () => request("post", "/keys", { apiKey, accountGroup }), "Key 已加入池中并保持禁用");
  singleKey.value = "";
  selectedGroup.value = "__new__";
}

async function readImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  clearPreview();
  if (!file) return;
  fileName.value = file.name;
  if (file.size > 1024 * 1024) {
    errorText.value = "TXT 文件超过 1 MB，未读取导入内容";
    input.value = "";
    return;
  }
  try {
    const source = await file.text();
    preview.value = await parseH3KeyImport(source);
    if (preview.value.failures.length) ElMessage.warning(`预览发现 ${preview.value.failures.length} 行格式问题；仅显示行号和原因`);
  } catch (error) { errorText.value = errorMessage(error); }
  finally { input.value = ""; }
}

async function confirmImport() {
  const current = preview.value;
  if (!current?.entries.length || busy.value) return;
  try {
    await ElMessageBox.confirm(
      `将提交 ${current.entries.length} 个消费级 Key 和匿名账号组标识。邮箱、两类密码及旧积分不会发送。导入只入池并保持禁用，不探测余额，也不会创建视频任务。继续吗？`,
      "确认导入 H3 Key",
      { type: "warning", confirmButtonText: "只导入 Key", cancelButtonText: "取消" },
    );
  } catch { return; }

  busy.value = "import";
  errorText.value = "";
  const entries = current.entries;
  try {
    const result = await request<{ added: number; existing: number; failed: { index: number; reason: string }[] }>("post", "/keys/import", {
      items: entries.map(({ apiKey, accountGroup }) => ({ apiKey, accountGroup })),
    });
    const lineFailures = result.failed.map(item => `第 ${entries[item.index]?.line ?? "?"} 行：${item.reason}`);
    const summary = `新增 ${result.added} 个，已存在 ${result.existing} 个，失败 ${result.failed.length} 个`;
    if (lineFailures.length) errorText.value = `${summary}。${lineFailures.join("；")}`;
    else ElMessage.success(summary);
    await loadOverview();
    emit("updated");
  } catch (error) { errorText.value = errorMessage(error); }
  finally {
    clearPreview();
    busy.value = "";
  }
}

function clearPreview() {
  preview.value = undefined;
  fileName.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

async function probeKey(key: H3Key) {
  await mutate(`probe:${key.keyId}`, () => request("post", `/keys/${encodeURIComponent(key.keyId)}/probe`, {}), "余额探测完成；新导入 Key 仍保持禁用");
  if (errorText.value) errorText.value = `余额探测失败。本机服务可能已按安全策略暂停执行器并停用该 Key。${errorText.value}`;
}

async function toggleKey(key: H3Key) {
  await mutate(`key:${key.keyId}`, () => request("patch", `/keys/${encodeURIComponent(key.keyId)}`, { enabled: !key.enabled }), key.enabled ? "Key 已停用" : "Key 已启用");
}

async function saveScheduler() {
  await mutate("settings", () => request("patch", "/settings", { maxConcurrent: scheduler.value.maxConcurrent, minCredits: scheduler.value.minCredits }), "调度设置已保存");
}

async function setExecutor(action: "pause" | "resume") {
  await mutate(action, () => request("post", `/executor/${action}`, {}), action === "pause" ? "执行器已暂停" : "执行器已恢复");
}

function resetTransientState() {
  singleKey.value = "";
  clearPreview();
  errorText.value = "";
}
</script>

<style scoped lang="scss">
.h3Manager { display: grid; gap: 14px; }
.h3Tabs { min-height: 380px; }
.overviewGrid, .keyTools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.overviewGrid :deep(.el-card__body), .keyTools :deep(.el-card__body) { min-width: 0; }
.statusRows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.statusRows > div { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.overviewActions, .executorControls, .sectionHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.overviewActions { margin-top: 18px; }
.muted { color: var(--el-text-color-secondary); line-height: 1.6; }
.hint { display: block; margin-top: 9px; line-height: 1.5; }
.fullWidth { width: 100%; }
.fileName { display: inline-block; margin-left: 10px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
.previewCard, .keysCard, .jobsCard { margin-top: 12px; }
.failureTable { margin-top: 12px; }
.importConfirm { margin-top: 14px; }
.schedulerCard { max-width: 740px; }
.schedulerForm { max-width: 560px; }
.executorControls { align-items: flex-start; }
.executorControls .muted { margin: 6px 0 0; }
@media (max-width: 720px) {
  .overviewGrid, .keyTools, .statusRows { grid-template-columns: 1fr; }
  .executorControls { flex-direction: column; }
}
</style>
