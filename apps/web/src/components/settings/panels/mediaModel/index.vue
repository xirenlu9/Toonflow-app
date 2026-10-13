<template>
  <div v-if="loaded" class="providerList">
    <div class="itemList">
      <el-card v-for="item in sortedProviders" :key="item.fileName" class="providerItem" shadow="never">
        <div class="providerHeader">
          <div v-if="item.icon || item.id.toLowerCase() === 'tfrouter'" class="providerMark" aria-hidden="true">
            <img class="providerLogo" :class="{ monochrome: item.id.toLowerCase() === 'tfrouter' }" :src="item.icon || logoUrl" alt="" />
          </div>
          <div class="providerInfo">
            <div class="providerHeading">
              <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
              <el-tag v-if="item.id.toLowerCase() === 'tfrouter'" size="small">官方</el-tag>
            </div>
            <el-text class="providerId" size="small" type="info" :title="item.fileName">{{ item.fileName }}</el-text>
          </div>
        </div>
        <el-alert v-if="item.loadError" :title="item.loadError" type="error" :closable="false" showIcon />
        <tfAccount v-if="item.id.toLowerCase() === 'tfrouter'" :apiKey="getProviderApiKey(item.id)" :visible="visible" :saveApiKey="(key) => saveProviderApiKey(item.id, key)" />
        <div v-if="isH3Provider(item)" class="h3ProviderSummary">
          <el-tag :type="!h3Summary?.service.online || h3Summary.executor.storageBlocked ? 'danger' : h3Summary.executor.paused ? 'warning' : 'success'" size="small">
            {{ !h3Summary?.service.online ? '本机服务离线' : h3Summary.executor.storageBlocked ? '执行器异常' : h3Summary.executor.paused ? '执行器已暂停' : '本机服务在线' }}
          </el-tag>
          <el-text v-if="h3Summary?.service.online" type="info" size="small">
            Key {{ h3Summary.keys.length }} 个 · 已启用 {{ h3Summary.keys.filter(key => key.enabled).length }} 个 · 活动任务 {{ h3Summary.executor.activeTasks }} 个
          </el-text>
          <el-text v-else type="info" size="small">打开 Key 池管理可查看启动提示；H3 不使用供应商静态 API Key。</el-text>
          <el-text v-if="item.models[0]" class="h3ModelName" size="small">可用于视频节点：{{ item.models[0].label }}</el-text>
        </div>
        <div class="providerFooter">
          <div class="providerMeta">
            <el-tag v-if="item.version" size="small" type="info" effect="plain">v{{ item.version }}</el-tag>
            <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
          </div>
          <el-space class="itemActions" wrap>
            <template v-if="isH3Provider(item)">
              <el-button :type="h3ServiceRunning ? 'warning' : 'success'" :loading="h3Switching" :disabled="h3Switching || h3Summary?.executor.storageBlocked" title="暂停只阻止新的提交，已经受理的视频仍继续跟踪" @click="toggleH3Service">{{ h3ServiceRunning ? "关闭/暂停服务" : "开启/恢复服务" }}</el-button>
              <el-button type="primary" plain :disabled="h3Switching" @click="openH3Manager">管理 Key 池</el-button>
            </template>
            <template v-else>
              <el-button v-if="item.modelsUrl" text :icon="IconDownload" :loading="fetchingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError || !item.revision" @click="fetchModels(item)">获取模型</el-button>
              <el-button text :icon="IconEdit" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError" @click="editProvider(item)">编辑模型</el-button>
              <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item)">
                <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !item.revision">删除</el-button></template>
              </el-popconfirm>
            </template>
          </el-space>
        </div>
      </el-card>
    </div>
    <div class="providerActions">
      <el-button class="addButton" :icon="IconPlus" @click="openAdd('builtin')">添加供应商</el-button>
      <el-button class="addButton" :icon="IconSettings" @click="openAdd('custom')">添加自定义供应商</el-button>
    </div>
    <component :is="mediaProviderDialog" v-model="providerDialogVisible" :mode="addMode" @added="saveProviderItem" />
    <component :is="editProviderDialog" v-model="editorVisible" :provider="editingProvider" @saved="saveProviderItem" />
    <component :is="h3ManagerDialog" v-model="h3ManagerVisible" @updated="loadH3Summary" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref, shallowRef, watch, type Component } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconPlus, IconSettings, IconEdit, IconTrash, IconDownload } from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logo.svg";
import type { MediaProvider } from "./types";
import { settings, saveSettings } from "@/stores/settings";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import tfAccount from "../../tfAccount.vue";

const { visible = true } = defineProps<{ visible?: boolean }>();
const mediaProviderDialog = shallowRef<Component>();
const editProviderDialog = shallowRef<Component>();
const h3ManagerDialog = shallowRef<Component>();
const providers = ref<MediaProvider[]>([]);
const sortedProviders = computed(() => [...providers.value].sort((a, b) => Number(b.id.toLowerCase() === "tfrouter") - Number(a.id.toLowerCase() === "tfrouter")));
const loaded = ref(false);
const providerDialogVisible = ref(false);
const editorVisible = ref(false);
const addMode = ref<"builtin" | "custom">("builtin");
const editingProvider = ref<MediaProvider>();
const deletingFile = ref("");
const fetchingFile = ref("");
const h3ManagerVisible = ref(false);
const h3Switching = ref(false);
const h3Summary = ref<{
  service: { online: boolean; executor: string };
  executor: { paused: boolean; storageBlocked: boolean; activeTasks: number; queuedTasks?: number; canControl?: boolean };
  keys: { enabled: boolean }[];
} | null>(null);
const h3ServiceRunning = computed(() => !!h3Summary.value?.service.online && !h3Summary.value.executor.paused && !h3Summary.value.executor.storageBlocked);
let loadRequest = 0;

function isH3Provider(provider: MediaProvider) { return provider.id === "runningHubH3"; }

function getProviderApiKey(id: string) {
  const configs = settings.value.mediaProviderConfigs as Record<string, { apiKey?: unknown }> | undefined;
  const apiKey = configs?.[id]?.apiKey;
  return typeof apiKey === "string" ? apiKey : "";
}

async function saveProviderApiKey(id: string, key: string) {
  await saveSettings(settings => {
    const configs = settings.mediaProviderConfigs;
    const current = configs && typeof configs === "object" && !Array.isArray(configs) ? configs as Record<string, unknown> : {};
    const existing = current[id];
    const config = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
    return { mediaProviderConfigs: { ...current, [id]: { ...config, apiKey: key } } };
  });
}

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "provider") void loadProviders();
}
onMounted(() => {
  void loadProviders();
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
});
watch(() => visible, value => { if (value) void loadH3Summary(); });
onBeforeUnmount(() => {
  loadRequest++;
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
});

async function loadProviders() {
  const request = ++loadRequest;
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    if (request === loadRequest) {
      providers.value = data.data;
      if (data.data.some(isH3Provider)) void loadH3Summary();
    }
  } catch (error) {
    if (request === loadRequest) ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : "读取媒体供应商失败");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

async function loadH3Summary() {
  try {
    const { data } = await axios.get<{ code: number; data: NonNullable<typeof h3Summary.value>; message: string }>("/api/runninghub-h3/overview", {
      timeout: 15000,
      headers: { "x-toonflow-desktop": "1", "Cache-Control": "no-store", Pragma: "no-cache" },
    });
    h3Summary.value = data.code === 200 ? data.data : null;
  } catch { h3Summary.value = null; }
  return h3Summary.value;
}

async function toggleH3Service() {
  if (h3Switching.value) return;
  const action = h3ServiceRunning.value ? "pause" : "resume";
  h3Switching.value = true;
  const options = { timeout: 90000, headers: { "x-toonflow-desktop": "1", "Cache-Control": "no-store", Pragma: "no-cache" } };
  try {
    let state = await loadH3Summary();
    if (!state?.service.online) {
      if (action === "pause") { ElMessage.info("本机服务已离线，无需重复暂停"); return; }
      await axios.post("/api/runninghub-h3/start", {}, options);
      state = await loadH3Summary();
    }
    if (!state?.service.online) throw new Error("本机 H3 服务未就绪，请打开 Key 池管理查看启动提示");
    if (!state.executor.canControl) throw new Error("当前 H3 Skill 不支持执行器控制，请更新本机 Skill");
    if (action === "resume" && (state.executor.queuedTasks ?? 0) > 0) {
      await ElMessageBox.confirm(`已有 ${state.executor.queuedTasks} 个待提交任务。恢复将继续处理这些任务，可能消耗额度，不会创建新任务。是否继续？`, "恢复 H3 队列", { type: "warning", confirmButtonText: "确认恢复", cancelButtonText: "保持暂停" });
    }
    const { data } = await axios.post<{ code: number; message: string }>(`/api/runninghub-h3/executor/${action}`, {}, options);
    if (data.code !== 200) throw new Error(data.message || "本机 H3 服务控制失败");
    ElMessage.success(action === "pause" ? "服务已关闭/暂停；已受理任务仍继续跟踪" : "服务已开启/恢复");
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "本机 H3 服务控制失败");
  } finally {
    await loadH3Summary();
    h3Switching.value = false;
  }
}

function openH3Manager() {
  h3ManagerDialog.value ??= defineAsyncComponent(() => import("./runningHubH3ManagerDialog.vue"));
  h3ManagerVisible.value = true;
}

function openAdd(mode: "builtin" | "custom") {
  mediaProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  addMode.value = mode;
  providerDialogVisible.value = true;
}

function editProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || provider.loadError) return;
  editProviderDialog.value ??= defineAsyncComponent(() => import("./editProviderDialog.vue"));
  editingProvider.value = provider;
  editorVisible.value = true;
}

async function fetchModels(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.modelsUrl || !provider.revision || provider.loadError) return;
  fetchingFile.value = provider.fileName;
  try {
    const { data } = await axios.post<{ code: number; data: MediaProvider; message: string }>("/api/providers/media/models", {
      fileName: provider.fileName, revision: provider.revision,
    }, { timeout: 35000 });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "获取模型失败");
    saveProviderItem(data.data);
    invalidateNodeModels("media");
    ElMessage.success("模型列表已更新");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "获取模型失败，请重试");
  } finally { fetchingFile.value = ""; }
}

async function deleteProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.revision) return;
  deletingFile.value = provider.fileName;
  let deleted = false;
  try {
    await axios.delete("/api/providers/media/delete", { data: { fileName: provider.fileName, revision: provider.revision } });
    deleted = true;
    loadRequest++;
    invalidateNodeModels("media");
    providers.value = providers.value.filter(item => item.fileName !== provider.fileName);
    await saveSettings(settings => {
      const configs = settings.mediaProviderConfigs;
      if (!configs || typeof configs !== "object" || Array.isArray(configs) || !Object.hasOwn(configs, provider.id)) return;
      const current = { ...configs } as Record<string, unknown>;
      delete current[provider.id];
      return { mediaProviderConfigs: current };
    });
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "删除失败，请重试";
    ElMessage.error(deleted ? `供应商已删除，连接配置未清理：${message}` : message);
  } finally { deletingFile.value = ""; }
}

function saveProviderItem(provider: MediaProvider) {
  loadRequest++;
  const index = providers.value.findIndex(item => item.fileName === provider.fileName);
  if (index < 0) providers.value.push(provider);
  else providers.value.splice(index, 1, provider);
}
</script>

<style lang="scss" scoped src="../../providerList.scss"></style>
<style lang="scss" scoped>
.h3ProviderSummary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 14px; }
.h3ModelName { flex-basis: 100%; }
</style>
