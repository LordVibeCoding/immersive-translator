import { CONTENT_FLUSH_MS, MUTATION_DEBOUNCE_MS, TR_TAG } from '../shared/constants';
import type { TranslateItem, TranslateRequest } from '../shared/messages';
import type { DisplayMode } from '../shared/settings';
import type { TextTranslator } from './local-engine';
import { applyMode, clearTranslation, injectStyles, isRendered, renderTranslation, type Level } from './renderer';
import { findBlocks, readUnit, type Unit } from './scanner';
import { shouldTranslate } from './text-filter';

export interface VisibilityObserver {
  observe(el: Element): void;
  disconnect(): void;
}

/** 实现方负责：元素进入视口后回调一次并停止观察该元素 */
export type CreateVisibilityObserver = (onVisible: (els: readonly Element[]) => void) => VisibilityObserver;

export interface ControllerDeps {
  readonly doc: Document;
  readonly local: TextTranslator | null;
  readonly llmEnabled: boolean;
  readonly mode: DisplayMode;
  readonly sendToLlm: (request: TranslateRequest) => void;
  readonly createVisibilityObserver: CreateVisibilityObserver;
}

const isTr = (node: Node) => node.nodeName.toLowerCase() === TR_TAG;

export class Controller {
  private enabled = false;
  private mode: DisplayMode;
  private nextId = 0;
  private readonly units = new Map<string, Unit>();
  private readonly sources = new WeakMap<Element, string>();
  private readonly inFlight = new WeakSet<Element>();
  private readonly blockIds = new WeakMap<Element, string>();
  private readonly pending = new Set<Element>();
  private readonly mutationRoots = new Set<Element>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private mutationTimer: ReturnType<typeof setTimeout> | undefined;
  private visibility: VisibilityObserver | null = null;
  private mutations: MutationObserver | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.mode = deps.mode;
  }

  get state(): { readonly enabled: boolean; readonly mode: DisplayMode } {
    return { enabled: this.enabled, mode: this.mode };
  }

  enable(): void {
    if (this.enabled) return;
    const { doc } = this.deps;
    this.enabled = true;
    injectStyles(doc);
    applyMode(doc, true, this.mode);
    this.visibility = this.deps.createVisibilityObserver((els) => this.onVisible(els));
    this.mutations = new MutationObserver((records) => this.onMutations(records));
    this.mutations.observe(doc.body, { childList: true, subtree: true, characterData: true });
    this.scan(doc.body);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    applyMode(this.deps.doc, false, this.mode);
    this.visibility?.disconnect();
    this.mutations?.disconnect();
    this.visibility = null;
    this.mutations = null;
    clearTimeout(this.flushTimer);
    clearTimeout(this.mutationTimer);
    this.flushTimer = undefined;
    this.mutationTimer = undefined;
    this.pending.clear();
    this.mutationRoots.clear();
  }

  toggle(): void {
    if (this.enabled) this.disable();
    else this.enable();
  }

  setMode(mode: DisplayMode): void {
    this.mode = mode;
    applyMode(this.deps.doc, this.enabled, mode);
  }

  handleResult(id: string, text: string): void {
    this.render(id, text, 'final');
  }

  private scan(root: Element): void {
    findBlocks(root).forEach((block) => this.visibility?.observe(block));
  }

  private onVisible(els: readonly Element[]): void {
    els.forEach((el) => this.pending.add(el));
    this.flushTimer ??= setTimeout(() => this.flush(), CONTENT_FLUSH_MS);
  }

  private flush(): void {
    this.flushTimer = undefined;
    const blocks = [...this.pending];
    this.pending.clear();
    const items = blocks.flatMap((block) => this.prepare(block) ?? []);
    if (items.length === 0) return;
    if (this.deps.llmEnabled) {
      this.deps.sendToLlm({ type: 'translate', pageTitle: this.deps.doc.title, items });
    }
    this.translateLocally(items);
  }

  /** 原文未变且已渲染或正在翻译时跳过；否则清掉旧译文并登记新任务 */
  private prepare(block: Element): TranslateItem | null {
    const unit = readUnit(block);
    if (!unit || !shouldTranslate(unit.text)) return null;
    const unchanged = this.sources.get(block) === unit.text;
    if (unchanged && (isRendered(block) || this.inFlight.has(block))) return null;
    clearTranslation(block);
    this.sources.set(block, unit.text);
    this.inFlight.add(block);
    const oldId = this.blockIds.get(block);
    if (oldId) this.units.delete(oldId);
    const id = String(this.nextId++);
    this.units.set(id, unit);
    this.blockIds.set(block, id);
    return { id, text: unit.text };
  }

  /** 释放一个永远不会到达 final 的任务条目（仅在没有大模型精翻兜底时调用） */
  private abandon(id: string): void {
    const unit = this.units.get(id);
    this.units.delete(id);
    if (unit) this.inFlight.delete(unit.block);
  }

  private translateLocally(items: readonly TranslateItem[]): void {
    const { local, llmEnabled } = this.deps;
    if (!local) return;
    const level: Level = llmEnabled ? 'draft' : 'final';
    for (const item of items) {
      local.translate(item.text).then(
        (text) => this.render(item.id, text, level),
        (err: unknown) => {
          console.warn('[沉浸翻译] 本地翻译失败', err);
          if (!llmEnabled) this.abandon(item.id);
        },
      );
    }
  }

  private render(id: string, text: string, level: Level): void {
    const unit = this.units.get(id);
    if (!unit || this.sources.get(unit.block) !== unit.text) return;
    renderTranslation(unit, text, level);
    if (level === 'final') {
      this.units.delete(id);
      this.inFlight.delete(unit.block);
    }
  }

  private onMutations(records: readonly MutationRecord[]): void {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest(TR_TAG)) continue;
      if (record.type === 'characterData') this.mutationRoots.add(target);
      record.addedNodes.forEach((node) => {
        const root = node instanceof Element ? node : node.parentElement;
        if (root && !isTr(node)) this.mutationRoots.add(root);
      });
      if ([...record.removedNodes].some(isTr)) this.mutationRoots.add(target);
    }
    if (this.mutationRoots.size > 0) {
      this.mutationTimer ??= setTimeout(() => this.flushMutations(), MUTATION_DEBOUNCE_MS);
    }
  }

  private flushMutations(): void {
    this.mutationTimer = undefined;
    const roots = [...this.mutationRoots];
    this.mutationRoots.clear();
    roots.filter((root) => root.isConnected).forEach((root) => this.scan(root));
  }
}
