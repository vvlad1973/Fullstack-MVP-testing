/**
 * @module features/tests/editor/sections/feedback-editor-modal
 * @description Unified feedback editor modal (PRD-7 FR-36 / FR-37).
 *
 * Wireframe: `prd7-editor-drawer.html` state `s-feedback-edit` (line 1025+).
 * The same composite UI is used across all feedback editing contexts:
 *   - test-level overall feedback (Настройки → Основное)
 *   - topic-level «failureFeedback» in adaptive mode (Адаптивный режим)
 *   - per-level feedback inside an adaptive level card
 *   - per-topic feedback in Состав tab (TopicRow)
 *
 * Composition:
 *   1-2. Text: the design-system `RichTextEditor` with its own mode switch
 *      («Простой текст» / «Форматированный» / «HTML») and, in the formatted mode,
 *      the paragraph-style list (`RTE_BLOCK_STYLES`; wireframe
 *      `docs/wireframes/approved/rte-paragraph-styles.html`). The stored `format`
 *      keeps its values (`plain` / `richText` / `html`); plain text is kept as the
 *      author's source with real line breaks (`sourceMode`). The link button opens
 *      this modal's own «Вставить ссылку» dialog through `onRequestLink`.
 *   3. Links list — array of {title, url} editable rows + «Добавить ссылку» button.
 *      The button is wrapped in a <div> to prevent flex-column stretching.
 *   4. Materials list — array of {title, url} editable rows + «Добавить материал»
 *      button, identical shape to the links list above (PRD-42). Not a file picker:
 *      the author types a real external URL. A descriptor saved before PRD-42
 *      through the retired upload flow (`url: /api/media/<id>`, or a legacy
 *      `scormHref`) is shown and edited the same way as any other row — its
 *      address is left as is unless the author types over it.
 *
 * Footer: «Отменить» (secondary) + «Сохранить» (primary).
 * The modal owns a draft copy of the values; on Save it emits via `onSave`.
 */
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Link as LinkIcon, Plus, Trash2 } from "lucide-react";
import {
  Button,
  IconButton,
  Input,
  ModalDialog,
  RichTextEditor,
  type RichTextMode,
} from "@skillum/ui-kit";
import { richTextToPlain } from "@shared/template/rich-text";
import type { FeedbackAsset } from "../test-editor.types";
import { plainTextToHtml, sanitizePastedHtml } from "./rte-paste";
import { RTE_BLOCK_STYLES } from "./rte-block-styles";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackFormat = "plain" | "richText" | "html";

/** Course recommendation — URL required (label «Курсы» in the UI). */
export type FeedbackLink = { title: string; url: string };

/** Event recommendation (TD-02) — URL optional. */
export type FeedbackEvent = { title: string; url?: string };

/** Value shape passed in and emitted by the modal. `assets` are canonical — no UI-only fields. */
export type FeedbackEditorValue = {
  format: FeedbackFormat;
  text: string;
  /** Recommended courses (UI label «Курсы»). */
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  /** Recommended events (TD-02). Optional in the type so legacy callers compile. */
  events?: FeedbackEvent[];
};

export type FeedbackEditorModalProps = {
  open: boolean;
  /** Modal title — e.g. «Обратная связь по теме «Основы ИБ»». */
  title: string;
  /** Subtitle / description rendered under the title. */
  description?: string;
  value: FeedbackEditorValue;
  /** When true, the «Материалы» section is hidden entirely (e.g. for level feedback). */
  hideAssets?: boolean;
  /** When true, the «Мероприятия» section is hidden (contexts that do not persist events). */
  hideEvents?: boolean;
  /**
   * When true, the «Курсы» section is hidden. Set by contexts that store a TEXT and
   * nothing else — the intro blocks of the results screen and the report: a link there
   * would be persisted nowhere and silently lost on save.
   */
  hideLinks?: boolean;
  /**
   * Метка поля текста. По умолчанию «Текст обратной связи» — то, чем эта модалка была
   * всегда. Толкование правится ею же, но обратной связью НЕ является, и метка, зовущая
   * его чужим именем, прямо противоречит тому, ради чего эти две сущности разделены.
   */
  textLabel?: string;
  onCancel: () => void;
  onSave: (value: FeedbackEditorValue) => void;
  /** Optional test id for the modal root. */
  testId?: string;
};

// ─── Local draft type ─────────────────────────────────────────────────────────

/**
 * Draft-only asset. Extends the canonical descriptor with a UI-only `uid` — row identity
 * for React, see {@link nextDraftUid}. Stripped before the value is emitted.
 */
type DraftAsset = FeedbackAsset & { uid: string };

type DraftValue = Omit<FeedbackEditorValue, "assets" | "events"> & {
  assets: DraftAsset[];
  /** Always a concrete array in the draft (normalized from the optional prop). */
  events: FeedbackEvent[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let draftUidSeq = 0;

/**
 * Issues a row identity for the assets list.
 *
 * The asset id from a legacy upload cannot serve as the React key: two rows saved from the
 * same upload (before PRD-42 retired it) can carry the SAME registry id — duplicate keys on
 * a list with editable fields and a delete button. The draft uid is unique per row by
 * construction and never leaves the modal.
 */
function nextDraftUid(): string {
  return `draft-asset-${++draftUidSeq}`;
}

/** Gives every incoming descriptor a row identity (they arrive without one). */
function toDraftAssets(assets: FeedbackAsset[]): DraftAsset[] {
  return assets.map((asset) => ({ ...asset, uid: nextDraftUid() }));
}

/** Stored format -> entry mode of the editor component. */
function toMode(format: FeedbackFormat): RichTextMode {
  return format === "richText" ? "rich" : format;
}

/** Entry mode of the editor component -> stored format. */
function toFormat(mode: RichTextMode): FeedbackFormat {
  return mode === "rich" ? "richText" : mode;
}

/**
 * Crossing the plain boundary: plain source becomes paragraphs, markup becomes text with
 * its line breaks. The same converters the product uses elsewhere for this text.
 */
const PLAIN_SOURCE = {
  toMarkup: (text: string) => plainTextToHtml(text),
  toPlain: (html: string) => richTextToPlain(html, "richText"),
};

// ─── Component ────────────────────────────────────────────────────────────────

/** @public */
export function FeedbackEditorModal(props: FeedbackEditorModalProps) {
  const textLabel = props.textLabel ?? "Текст обратной связи";
  const [draft, setDraft] = useState<DraftValue>(() => ({
    ...props.value,
    assets: toDraftAssets(props.value.assets),
    events: props.value.events ?? [],
  }));
  // S13.1-G39: link-insert dialog. The editor asks for a link through `onRequestLink`
  // and waits; the dialog settles that wait with the address or with `null` on cancel.
  const [linkInsert, setLinkInsert] = useState<{ url: string; text: string } | null>(null);
  const linkResolver = useRef<((answer: { url: string; text?: string } | null) => void) | null>(null);

  // Reset draft when the modal re-opens or receives a new value.
  useEffect(() => {
    if (!props.open) return;
    const newVal = props.value;
    // The editor re-binds its formatted area only when the text differs from what the area
    // already shows, so replacing the draft never moves a caret the author is using.
    setDraft({ ...newVal, assets: toDraftAssets(newVal.assets), events: newVal.events ?? [] });
  }, [props.open, props.value]);

  /** The editor's link button: opens the dialog prefilled with the selected text. */
  function requestLink(selectedText: string): Promise<{ url: string; text?: string } | null> {
    return new Promise((resolve) => {
      linkResolver.current = resolve;
      setLinkInsert({ url: "", text: selectedText });
    });
  }

  /** Settles the editor's wait and closes the dialog. */
  function settleLink(answer: { url: string; text?: string } | null) {
    linkResolver.current?.(answer);
    linkResolver.current = null;
    setLinkInsert(null);
  }

  /** Commit of the link dialog. */
  function handleLinkInsertSubmit() {
    if (!linkInsert) return;
    const url = linkInsert.url.trim();
    if (!url) return;
    settleLink({ url, text: linkInsert.text.trim() });
  }

  /** Strip the UI-only `uid` before emitting to the caller. */
  function handleSave() {
    const canonical: FeedbackEditorValue = {
      ...draft,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      assets: draft.assets.map(({ uid: _u, ...rest }) => rest),
    };
    props.onSave(canonical);
  }

  return (
    <>
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="l"
      title={props.title}
      description={props.description}
      footer={
        <>
          <Button
            variant="secondary"
            size="m"
            onClick={props.onCancel}
            data-testid="feedback-editor-cancel"
          >
            Отменить
          </Button>
          <Button
            variant="primary"
            size="m"
            onClick={handleSave}
            data-testid="feedback-editor-save"
          >
            Сохранить
          </Button>
        </>
      }
      data-testid={props.testId ?? "feedback-editor"}
    >
      <div className="tb-feedback-editor">
        {/* ── Text: mode switch, toolbar with paragraph styles, field ──── */}
        <div className="tb-feedback-editor__section">
          <RichTextEditor
            label={textLabel}
            fullWidth
            rows={6}
            value={draft.text}
            onChange={(text) => setDraft((d) => ({ ...d, text }))}
            mode={toMode(draft.format)}
            onModeChange={(mode) => setDraft((d) => ({ ...d, format: toFormat(mode) }))}
            sourceMode={PLAIN_SOURCE}
            // Pasted text keeps only what the editor can produce itself: inline styles from
            // Word or a web page would beat the template's font on the results screen.
            transformPaste={sanitizePastedHtml}
            blockStyles={RTE_BLOCK_STYLES}
            onRequestLink={requestLink}
            data-testid="feedback-editor-text"
          />
        </div>

        {/* ── Courses section (data field `links`; UI label «Курсы») ────── */}
        {!props.hideLinks && (
        <div className="tb-feedback-editor__section">
          <div className="tb-feedback-editor__sec-title">
            <LinkIcon size={14} aria-hidden="true" />
            Курсы
          </div>
          {/* No empty-state per wireframe — just the list (if any) + button. */}
          {draft.links.length > 0 && (
            <ul className="tb-feedback-editor__list" aria-label="Курсы">
              {draft.links.map((link, idx) => (
                <li key={idx} className="tb-feedback-editor__item">
                  <div className="tb-feedback-editor__item-fields">
                    <Input
                      size="s"
                      fullWidth
                      aria-label="Название курса"
                      value={link.title}
                      placeholder="Название"
                      onChange={(e) => {
                        const title = e.target.value;
                        setDraft((d) => {
                          const links = [...d.links];
                          links[idx] = { ...links[idx], title };
                          return { ...d, links };
                        });
                      }}
                      data-testid={`feedback-editor-link-title-${idx}`}
                    />
                    <Input
                      size="s"
                      fullWidth
                      type="url"
                      aria-label="URL курса"
                      value={link.url}
                      placeholder="https://…"
                      onChange={(e) => {
                        const url = e.target.value;
                        setDraft((d) => {
                          const links = [...d.links];
                          links[idx] = { ...links[idx], url };
                          return { ...d, links };
                        });
                      }}
                      data-testid={`feedback-editor-link-url-${idx}`}
                    />
                  </div>
                  <IconButton
                    icon={<Trash2 size={14} aria-hidden="true" />}
                    aria-label={`Удалить курс ${idx + 1}`}
                    variant="ghost"
                    size="s"
                    onClick={() => {
                      setDraft((d) => {
                        const links = [...d.links];
                        links.splice(idx, 1);
                        return { ...d, links };
                      });
                    }}
                    data-testid={`feedback-editor-link-remove-${idx}`}
                  />
                </li>
              ))}
            </ul>
          )}
          {/* Wrap in <div> so flex-column parent does not stretch the button full-width. */}
          <div>
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Plus size={12} aria-hidden="true" />}
              onClick={() =>
                setDraft((d) => ({ ...d, links: [...d.links, { title: "", url: "" }] }))
              }
              data-testid="feedback-editor-link-add"
            >
              Добавить курс
            </Button>
          </div>
        </div>
        )}

        {/* ── Events section (TD-02; URL optional) ─────────────────────── */}
        {!props.hideEvents && (
        <div className="tb-feedback-editor__section">
          <div className="tb-feedback-editor__sec-title">
            <CalendarDays size={14} aria-hidden="true" />
            Мероприятия
          </div>
          {draft.events.length > 0 && (
            <ul className="tb-feedback-editor__list" aria-label="Мероприятия">
              {draft.events.map((event, idx) => (
                <li key={idx} className="tb-feedback-editor__item">
                  <div className="tb-feedback-editor__item-fields">
                    <Input
                      size="s"
                      fullWidth
                      aria-label="Название мероприятия"
                      value={event.title}
                      placeholder="Название"
                      onChange={(e) => {
                        const title = e.target.value;
                        setDraft((d) => {
                          const events = [...d.events];
                          events[idx] = { ...events[idx], title };
                          return { ...d, events };
                        });
                      }}
                      data-testid={`feedback-editor-event-title-${idx}`}
                    />
                    <Input
                      size="s"
                      fullWidth
                      type="url"
                      aria-label="Ссылка на мероприятие (необязательно)"
                      value={event.url ?? ""}
                      placeholder="https://… (необязательно)"
                      onChange={(e) => {
                        const url = e.target.value;
                        setDraft((d) => {
                          const events = [...d.events];
                          events[idx] = { ...events[idx], url };
                          return { ...d, events };
                        });
                      }}
                      data-testid={`feedback-editor-event-url-${idx}`}
                    />
                  </div>
                  <IconButton
                    icon={<Trash2 size={14} aria-hidden="true" />}
                    aria-label={`Удалить мероприятие ${idx + 1}`}
                    variant="ghost"
                    size="s"
                    onClick={() => {
                      setDraft((d) => {
                        const events = [...d.events];
                        events.splice(idx, 1);
                        return { ...d, events };
                      });
                    }}
                    data-testid={`feedback-editor-event-remove-${idx}`}
                  />
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Plus size={12} aria-hidden="true" />}
              onClick={() =>
                setDraft((d) => ({ ...d, events: [...d.events, { title: "", url: "" }] }))
              }
              data-testid="feedback-editor-event-add"
            >
              Добавить мероприятие
            </Button>
          </div>
        </div>
        )}

        {/* ── Materials section (data field `assets`; UI label «Материалы»,
            PRD-42) ─────────────────────────────────────────────────────── */}
        {!props.hideAssets && (
          <div className="tb-feedback-editor__section">
            <div className="tb-feedback-editor__sec-title">
              <LinkIcon size={14} aria-hidden="true" />
              Материалы
            </div>
            {draft.assets.length > 0 && (
              <ul className="tb-feedback-editor__list" aria-label="Материалы">
                {/* Keyed by the draft uid, not the asset id: a legacy upload can hand two
                    rows one id. */}
                {draft.assets.map((asset, i) => (
                  <li key={asset.uid} className="tb-feedback-editor__item">
                    <div className="tb-feedback-editor__item-fields">
                      <Input
                        size="s"
                        fullWidth
                        aria-label="Название материала"
                        value={asset.title}
                        placeholder="Название"
                        onChange={(e) => {
                          const title = e.target.value;
                          setDraft((d) => {
                            const assets = [...d.assets];
                            assets[i] = { ...assets[i], title };
                            return { ...d, assets };
                          });
                        }}
                        data-testid={`feedback-editor-asset-title-${i}`}
                      />
                      <Input
                        size="s"
                        fullWidth
                        type="url"
                        aria-label="URL материала"
                        value={asset.url ?? ""}
                        placeholder="https://…"
                        onChange={(e) => {
                          const url = e.target.value;
                          setDraft((d) => {
                            const assets = [...d.assets];
                            assets[i] = { ...assets[i], url };
                            return { ...d, assets };
                          });
                        }}
                        data-testid={`feedback-editor-asset-url-${i}`}
                      />
                    </div>
                    <IconButton
                      icon={<Trash2 size={14} aria-hidden="true" />}
                      aria-label={`Удалить материал ${i + 1}`}
                      variant="ghost"
                      size="s"
                      onClick={() => {
                        setDraft((d) => {
                          const assets = [...d.assets];
                          assets.splice(i, 1);
                          return { ...d, assets };
                        });
                      }}
                      data-testid={`feedback-editor-asset-remove-${i}`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button
                variant="secondary"
                size="s"
                leadingIcon={<Plus size={12} aria-hidden="true" />}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    assets: [...d.assets, { uid: nextDraftUid(), title: "", url: "" }],
                  }))
                }
                data-testid="feedback-editor-asset-add"
              >
                Добавить материал
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>

    {/* ── S13.1-G39: link-insert sub-modal (replaces window.prompt) ─── */}
    {linkInsert !== null && (
      <ModalDialog
        open
        onClose={() => settleLink(null)}
        size="s"
        title="Вставить ссылку"
        description="Укажите URL и текст, который увидит обучающийся"
        data-testid="rte-link-modal"
        footer={
          <>
            <Button
              variant="ghost"
              size="s"
              onClick={() => settleLink(null)}
              data-testid="rte-link-cancel"
            >
              Отмена
            </Button>
            <Button
              variant="primary"
              size="s"
              onClick={handleLinkInsertSubmit}
              disabled={linkInsert.url.trim() === ""}
              data-testid="rte-link-submit"
            >
              Вставить
            </Button>
          </>
        }
      >
        <div className="tb-link-insert">
          <Input
            size="m"
            fullWidth
            type="url"
            label="URL"
            placeholder="https://…"
            value={linkInsert.url}
            autoFocus
            onChange={(e) =>
              setLinkInsert((s) => (s ? { ...s, url: e.target.value } : s))
            }
            data-testid="rte-link-url"
          />
          <Input
            size="m"
            fullWidth
            label="Текст ссылки"
            placeholder="Оставьте пустым, чтобы показать URL"
            value={linkInsert.text}
            onChange={(e) =>
              setLinkInsert((s) => (s ? { ...s, text: e.target.value } : s))
            }
            data-testid="rte-link-text"
          />
        </div>
      </ModalDialog>
    )}
    </>
  );
}
