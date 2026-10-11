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
            <el-button v-if="isH3Provider(item)" type="primary" plain @click="openH3Manager">管理 Key 池</el-button>
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
import { ElMessage } from "element-plus";
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
const h3Summary = ref<{
  service: { online: boolean; executor: string };
  executor: { paused: boolean; storageBlocked: boolean; activeTasks: number };
  keys: { enabled: boolean }[];
} | null>(null);
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
      timeout: 5000,
      headers: { "x-toonflow-desktop": "1", "Cache-Control": "no-store", Pragma: "no-cache" },
    });
    h3Summary.value = data.code === 200 ? data.data : null;
  } catch { h3Summary.value = null; }
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
