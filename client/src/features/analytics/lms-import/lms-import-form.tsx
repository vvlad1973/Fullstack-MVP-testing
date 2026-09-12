/**
 * @module features/analytics/lms-import/lms-import-form
 * @description Форма загрузки выгрузки отчёта LMS (PRD-54 раздел 11).
 *
 * ОДНА на три точки входа: экран «Импорт» встраивает её в страницу, обе страницы аналитики — в
 * `ModalDialog`. Копии разошлись бы поведением сухого прогона и предупреждений, а разойдясь,
 * начали бы обещать разное про один и тот же файл.
 *
 * Хост может отдать уже разобранный файл (экран импорта опознаёт вид до ветвления) либо не отдать
 * ничего — тогда форма показывает собственный загрузчик и опознаёт файл сама.
 *
 * Эскиз: `docs/wireframes/prd54-lms-import.html` (согласован 2026-09-12).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Trash2, Upload, X } from "lucide-react";
import {
  Banner,
  Button,
  Checkbox,
  Cluster,
  EmptyState,
  FileItem,
  FileUploader,
  Input,
  Select,
  Spinner,
  Stack,
  Tag,
  Text,
} from "@skillum/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

/** Сентинелы списка групп — по образцу `NEW_TEST = "__new__"` со страницы «Импорт». */
const NO_GROUP = "__none__";
const NEW_GROUP = "__new__";

/** Ответ `/api/workbook/inspect` для выгрузки отчёта LMS. */
export interface LmsInspectResult {
  kind: "lmsExport";
  testId: string | null;
  testTitle: string | null;
  foreignQuestionIds?: string[];
  rows: number;
  questionIds: number;
  scaleKeys: string[];
  variableNames: string[];
  unknownColumns: string[];
  /** Подсказка: колонка участника похожа на ФИО, а не на идентификатор. */
  looksPersonal?: boolean;
}

/** Счётчики и протокол одного прогона — общие у сухого и настоящего. */
interface ImportOutcome {
  testId: string;
  testTitle: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsLinked: number;
  warnings: string[];
}

interface Batch {
  id: string;
  fileName: string;
  importedAt: string;
  rowsCreated: number;
  rowsUpdated: number;
  rowsLinked: number;
}

export interface LmsImportFormProps {
  /** Файл, уже выбранный хостом. Без него форма показывает свой загрузчик. */
  file?: File;
  /** Разбор, уже выполненный хостом. */
  inspect?: LmsInspectResult;
  /**
   * Задан на странице аналитики КОНКРЕТНОГО теста. Файл чужого теста тогда отвергается — это
   * единственная защита от загрузки посторонней выгрузки в открытую перед глазами аналитику.
   */
  fixedTestId?: string;
  /** Зовётся после успешного импорта — хост закрывает окно или сбрасывает страницу. */
  onDone?: () => void;
}

/** Килобайты файла для подписи под именем. */
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export function LmsImportForm({ file: hostFile, inspect: hostInspect, fixedTestId, onDone }: LmsImportFormProps) {
  const { toast } = useToast();

  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [ownInspect, setOwnInspect] = useState<LmsInspectResult | null>(null);
  const [notRecognized, setNotRecognized] = useState(false);
  const [group, setGroup] = useState<string>(NO_GROUP);
  const [newGroupName, setNewGroupName] = useState("");
  const [sourceAnonymized, setSourceAnonymized] = useState(false);
  const [linkUsers, setLinkUsers] = useState(false);
  const [plan, setPlan] = useState<ImportOutcome | null>(null);
  const [done, setDone] = useState<ImportOutcome | null>(null);

  const file = hostFile ?? ownFile;
  const inspect = hostInspect ?? ownInspect;
  const testId = inspect?.testId ?? null;
  const mismatch = !!fixedTestId && !!testId && fixedTestId !== testId;

  const groups = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/groups"] });
  const batches = useQuery<Batch[]>({
    queryKey: [`/api/analytics/lms-import/batches/${testId}`],
    enabled: !!testId && !mismatch,
  });

  /** Тело запроса: и сухой прогон, и импорт отправляют одно и то же. */
  function body(): FormData {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (fixedTestId) fd.append("fixedTestId", fixedTestId);
    if (group !== NO_GROUP && group !== NEW_GROUP) fd.append("groupId", group);
    if (group === NEW_GROUP) fd.append("newGroupName", newGroupName);
    fd.append("sourceAnonymized", String(sourceAnonymized));
    fd.append("linkUsers", String(linkUsers));
    return fd;
  }

  async function send(dryRun: boolean): Promise<ImportOutcome> {
    const res = await fetch(`/api/analytics/lms-import?dryRun=${dryRun}`, {
      method: "POST",
      body: body(),
      credentials: "include",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || "Не удалось выполнить загрузку");
    return payload as ImportOutcome;
  }

  const inspectMut = useMutation({
    mutationFn: async (f: File): Promise<LmsInspectResult> => {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/workbook/inspect", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("read failed");
      return res.json();
    },
    onSuccess: (data) => {
      // Книга теста в эту форму не годится: она про содержание теста, а не про прохождения.
      if (data.kind !== "lmsExport") { setNotRecognized(true); return; }
      setOwnInspect(data);
    },
    onError: () => setNotRecognized(true),
  });

  const dryMut = useMutation({ mutationFn: () => send(true), onSuccess: setPlan });
  const runMut = useMutation({
    mutationFn: () => send(false),
    onSuccess: (res) => {
      setDone(res);
      // Цифры на странице, с которой форму открыли, должны обновиться без перезагрузки.
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      batches.refetch();
      onDone?.();
    },
  });
  const rollbackMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/analytics/lms-import/batches/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Не удалось откатить загрузку");
    },
    onSuccess: () => {
      toast({ title: "Загрузка откачена" });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      batches.refetch();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  function reset() {
    setOwnFile(null);
    setOwnInspect(null);
    setNotRecognized(false);
    setPlan(null);
    setDone(null);
  }

  // ── Пусто: собственный загрузчик ─────────────────────────────────────────
  if (!file) {
    return (
      <FileUploader
        accept=".xlsx"
        onFiles={(files) => {
          const f = files[0];
          if (!f) return;
          setOwnFile(f);
          inspectMut.mutate(f);
        }}
      >
        <span className="ou-uploader__icon" aria-hidden="true"><Upload size={24} /></span>
        <span className="ou-uploader__title">Перетащите файл .xlsx или выберите</span>
        <span className="ou-uploader__sub">
          {fixedTestId ? "Только выгрузка отчёта LMS этого теста" : "Выгрузка отчёта LMS — вид определяется автоматически"}
        </span>
        <Button variant="secondary" size="s" type="button" tabIndex={-1}>Выбрать файл</Button>
      </FileUploader>
    );
  }

  const fileRow = (
    <FileItem
      name={file.name}
      meta={plan || done ? "запись ещё не выполнена" : `выгрузка отчёта LMS · ${inspect?.rows ?? "…"} строк · ${formatKb(file.size)}`}
      kind="xls"
      actions={runMut.isPending ? [] : [{ icon: <X size={14} />, ariaLabel: "Убрать файл", danger: true, onClick: reset }]}
    />
  );

  // ── Идёт разбор ──────────────────────────────────────────────────────────
  if (inspectMut.isPending) {
    return (
      <Stack gap={3}>
        {fileRow}
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Читаем файл…</Text></Cluster>
      </Stack>
    );
  }

  // ── Файл не распознан ────────────────────────────────────────────────────
  if (notRecognized) {
    return (
      <Stack gap={3}>
        {fileRow}
        <Banner
          tone="error"
          title="Файл не распознан"
          description="Это не выгрузка отчёта LMS. Проверьте, что выгружали отчёт по SCORM-модулю, а не что-то другое."
        />
        <Cluster justify="end"><Button variant="secondary" onClick={reset}>Выбрать другой файл</Button></Cluster>
      </Stack>
    );
  }

  // ── Тест по вопросам не найден ───────────────────────────────────────────
  if (inspect && !testId) {
    return (
      <Stack gap={3}>
        {fileRow}
        <Banner
          tone="error"
          title="Тест по файлу не определён"
          description={`Из ${inspect.questionIds} вопросов файла ни один однозначно не указывает на тест этой установки. Похоже, выгрузка сделана по тесту из другой системы.`}
        />
        <Cluster justify="end"><Button variant="secondary" onClick={reset}>Выбрать другой файл</Button></Cluster>
      </Stack>
    );
  }

  // ── Чужой тест ───────────────────────────────────────────────────────────
  if (mismatch) {
    return (
      <Stack gap={3}>
        {fileRow}
        <Banner
          tone="error"
          title="Это выгрузка другого теста"
          description={`В файле — «${inspect?.testTitle ?? testId}». Открыта аналитика другого теста, и записать эти строки сюда нельзя.`}
        />
        <Cluster justify="end"><Button variant="secondary" onClick={reset}>Выбрать другой файл</Button></Cluster>
      </Stack>
    );
  }

  // ── Готово ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <Stack gap={3}>
        <Banner
          tone="success"
          title="Загрузка завершена"
          description={`Добавлено ${done.rowsCreated}, обновлено ${done.rowsUpdated}, пропущено ${done.rowsSkipped}, связано с пользователями ${done.rowsLinked}.`}
        />
        <Cluster justify="end"><Button variant="secondary" onClick={reset}>Загрузить ещё</Button></Cluster>
      </Stack>
    );
  }

  const groupOptions = [
    { value: NO_GROUP, label: "Без группы" },
    { value: NEW_GROUP, label: "＋ Создать новую группу" },
    ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <Stack gap={3}>
      {fileRow}

      {inspect && (
        <Banner
          tone="info"
          icon={<CheckCircle2 size={16} />}
          title={inspect.testTitle ?? "Тест определён"}
          description={`${inspect.questionIds} вопросов, ${inspect.scaleKeys.length} шкал, ${inspect.variableNames.length} показателей. Тест определён по файлу — выбирать не нужно.`}
        />
      )}

      <Select
        label="Группа"
        hint="Разрез для аналитики. Метка ставится на прохождения этой загрузки."
        fullWidth
        value={group}
        onChange={setGroup}
        options={groupOptions}
        disabled={runMut.isPending}
      />
      {group === NEW_GROUP && (
        <Input
          label="Название новой группы"
          required
          fullWidth
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
      )}

      <Checkbox
        label="Данные уже обезличены"
        description="В колонке участника не ФИО, а идентификатор от внешнего инструмента. Повторно он не хешируется."
        checked={sourceAnonymized}
        onChange={(e) => setSourceAnonymized(e.target.checked)}
        disabled={runMut.isPending}
      />
      {sourceAnonymized && inspect?.looksPersonal && (
        <Banner
          tone="warning"
          icon={<AlertTriangle size={16} />}
          title="Похоже, данные всё-таки не обезличены"
          description="В колонке участника кириллица с пробелами — так выглядит ФИО, а не идентификатор. Снимите флажок, иначе имена попадут в базу как есть."
        />
      )}

      <Checkbox
        label="Связать с пользователями по ключу"
        description="Совпадение с внешним ключом пользователя свяжет прохождение с ним."
        checked={linkUsers}
        onChange={(e) => setLinkUsers(e.target.checked)}
        disabled={runMut.isPending}
      />

      {plan && (
        <Stack gap={2}>
          <Cluster gap={2} wrap>
            <Tag tone="success" variant="outline" size="s">Добавится: {plan.rowsCreated}</Tag>
            <Tag variant="outline" size="s">Обновится: {plan.rowsUpdated}</Tag>
            <Tag tone={plan.rowsSkipped > 0 ? "warning" : undefined} variant="outline" size="s">
              Пропустится: {plan.rowsSkipped}
            </Tag>
            <Tag variant="outline" size="s">Свяжется: {plan.rowsLinked}</Tag>
          </Cluster>
          {plan.warnings.map((w) => (
            <Banner key={w} tone="warning" icon={<AlertTriangle size={16} />} description={w} />
          ))}
        </Stack>
      )}

      {runMut.isPending && (
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Импортируем… Не закрывайте окно.</Text></Cluster>
      )}
      {runMut.isError && (
        <Banner
          tone="error"
          title="Загрузка не выполнена"
          description={`${(runMut.error as Error).message} Ничего не записано — можно повторить.`}
        />
      )}
      {dryMut.isError && (
        <Banner tone="error" title="Проверка не выполнена" description={(dryMut.error as Error).message} />
      )}

      <Cluster justify="end" gap={2}>
        <Button
          variant="secondary"
          onClick={() => dryMut.mutate()}
          loading={dryMut.isPending}
          disabled={runMut.isPending || (group === NEW_GROUP && !newGroupName.trim())}
        >
          Проверить
        </Button>
        {/* «Импортировать» до проверки заблокирована намеренно: план — единственное место, где
            предупреждения видны ДО записи, и пропустить его значит записать вслепую. */}
        <Button
          onClick={() => runMut.mutate()}
          loading={runMut.isPending}
          disabled={!plan || (group === NEW_GROUP && !newGroupName.trim())}
          title={!plan ? "Сначала проверьте файл" : undefined}
        >
          Импортировать
        </Button>
      </Cluster>

      {testId && (
        <Stack gap={2}>
          <Text variant="body-s" weight="medium">Загрузки этого теста</Text>
          {(batches.data ?? []).length === 0 ? (
            <EmptyState
              title="Выгрузки ещё не загружали"
              description="Здесь появится список загруженных файлов — с датой, автором и возможностью откатить."
            />
          ) : (
            <Stack gap={1}>
              {(batches.data ?? []).map((b) => (
                <Cluster key={b.id} gap={3} justify="between">
                  <Stack gap={0}>
                    <Text variant="body-s" weight="medium">{b.fileName}</Text>
                    <Text variant="body-xs" tone="muted">
                      {new Date(b.importedAt).toLocaleString("ru-RU")} · добавлено {b.rowsCreated}, обновлено {b.rowsUpdated}
                    </Text>
                  </Stack>
                  <Button
                    variant="ghost"
                    size="s"
                    leadingIcon={<Trash2 size={14} />}
                    onClick={() => rollbackMut.mutate(b.id)}
                    loading={rollbackMut.isPending}
                  >
                    Откатить
                  </Button>
                </Cluster>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}
