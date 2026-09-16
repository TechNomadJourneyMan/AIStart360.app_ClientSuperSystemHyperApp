"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  HONOR_SCENARIOS,
  type HonorConfig,
} from "@/lib/omnichannel/honor-policy";
import type { HonorCard } from "@/lib/omnichannel/honor-catalog";
const labels: Record<keyof typeof HONOR_SCENARIOS, string> = {
  new_dialog: "Новый диалог",
  returning: "Повторный диалог",
  promotion: "Честные акции",
  upsell: "Допродажа",
  missing_size: "Нет размера",
  delivery: "Доставка",
  visit: "Приглашение в магазин",
};
interface Data {
  settings: { channel: string; honor: HonorConfig | null }[];
  binding: { user_id: string; company_id: string } | null;
  defaults: typeof HONOR_SCENARIOS;
  accounts: string[];
  readiness: {
    note: string;
    cloudConfigured: boolean;
    commerceConfigured: boolean;
  };
  metrics: {
    inbound: number;
    conversations: number;
    missed: number;
    handoffs: number;
    rows: {
      actor: string;
      managerId: string | null;
      messages: number;
      conversations: number;
      averageResponseSeconds: number | null;
      firstResponseSeconds: number | null;
      clicks: number | null;
      carts: number | null;
      orders: number | null;
      confirmedRevenue: number | null;
      conversion: number | null;
    }[];
    coverage: { partial: boolean; notes: string[] };
  };
}
export function HonorControlPanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState("whatsapp"),
    [account, setAccount] = useState(""),
    [manager, setManager] = useState("");
  const [from, setFrom] = useState(
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [config, setConfig] = useState<HonorConfig | null>(null),
    [text, setText] = useState("Что есть на 15 градусов?"),
    [answer, setAnswer] = useState(""),
    [cards, setCards] = useState<HonorCard[]>([]);
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        channel,
        from: new Date(from).toISOString(),
        to: new Date(Date.parse(to) + 86400000).toISOString(),
      });
      if (account) q.set("account", account);
      if (manager) q.set("manager", manager);
      const r = await fetch("/api/giga-admin/omnichannel/honor?" + q, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    }
  }, [channel, account, manager, from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  const edit = () => {
    if (!data) return;
    const saved = data.settings.find((s) => s.channel === channel)?.honor;
    setConfig(
      saved ??
        (data.binding
          ? {
              enabled: true,
              account_id: account || data.accounts[0] || "",
              ...data.binding,
              scenarios: { ...HONOR_SCENARIOS },
            }
          : null),
    );
  };
  async function action(body: unknown) {
    setBusy(true);
    try {
      const r = await fetch("/api/giga-admin/omnichannel/honor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.sandbox) {
        setAnswer(d.answer);
        setCards(d.selection.cards);
      } else {
        toast.success(
          d.stopped
            ? "AI остановлен на всех каналах"
            : d.verified
              ? "Проверка записана. Автоответ можно включить отдельно."
              : "Сохранено в режиме AI-черновика",
        );
        await load();
        window.dispatchEvent(new Event("honor-settings-changed"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  const value = (v: number | null, suffix = "") =>
    v === null ? "Нет данных" : v.toLocaleString("ru-RU") + suffix;
  return (
    <section className="col-span-full space-y-4 rounded-2xl border border-blue-400/20 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">HONOR · управление AI</h3>
          <p className="text-xs text-slate-400">
            Каталог, безопасная проверка и статистика ответов
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void action({ action: "stop" })}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Аварийный стоп AI
        </button>
      </div>
      <p className="text-xs text-slate-400">
        Стоп запрещает новые автоматические отправки. Уже принятые сервисом
        сообщения отозвать нельзя. После ответа менеджера AI остаётся на паузе
        до явного возврата управления.
      </p>
      <div className="flex flex-wrap gap-3 text-xs text-slate-200">
        <label>
          Канал
          <select
            aria-label="Канал статистики"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setConfig(null);
            }}
            className="block rounded bg-slate-800 p-2"
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
          </select>
        </label>
        <label>
          Аккаунт
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="block rounded bg-slate-800 p-2"
          >
            <option value="">Все</option>
            {data?.accounts.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Менеджер (ID)
          <input
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            className="block rounded bg-slate-800 p-2"
          />
        </label>
        <label>
          С
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block rounded bg-slate-800 p-2"
          />
        </label>
        <label>
          По
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="block rounded bg-slate-800 p-2"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="text-xs text-amber-200">
            {data.readiness.note} Официальный WhatsApp:{" "}
            {data.readiness.cloudConfigured ? "настроен" : "не подключён"}.
            События магазина:{" "}
            {data.readiness.commerceConfigured ? "настроены" : "не подключены"}.
          </p>
          <p className="text-sm text-slate-200">
            Диалоги: {data.metrics.conversations} · Входящие:{" "}
            {data.metrics.inbound} · Без ответа: {data.metrics.missed} · На
            ручном управлении: {data.metrics.handoffs}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead>
                <tr>
                  {[
                    "Автор",
                    "Сообщения",
                    "Диалоги",
                    "Первый ответ",
                    "Средний ответ",
                    "Клики",
                    "Корзины",
                    "Заказы",
                    "Конверсия",
                    "Выручка",
                  ].map((t) => (
                    <th className="p-2" key={t}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.metrics.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="p-2">
                      {r.actor === "ai"
                        ? "AI"
                        : r.actor === "manager"
                          ? "Менеджер"
                          : r.actor === "system"
                            ? "Система"
                            : "Автор неизвестен"}
                      {r.managerId ? " · " + r.managerId : ""}
                    </td>
                    {[
                      r.messages,
                      r.conversations,
                      r.firstResponseSeconds,
                      r.averageResponseSeconds,
                      r.clicks,
                      r.carts,
                      r.orders,
                      r.conversion === null
                        ? null
                        : Math.round(r.conversion * 10000) / 100,
                      r.confirmedRevenue,
                    ].map((v, j) => (
                      <td className="p-2 whitespace-nowrap" key={j}>
                        {value(
                          v,
                          j === 2 || j === 3
                            ? " сек."
                            : j === 7
                              ? " %"
                              : j === 8
                                ? " ₸"
                                : "",
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-amber-200">
            {data.metrics.coverage.partial
              ? "Неполные исторические данные. "
              : ""}
            {data.metrics.coverage.notes.join(" ")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={edit}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-white"
          >
            Редактировать сценарии HONOR
          </button>
        </>
      )}
      {config && (
        <div className="space-y-3">
          <label className="block text-xs text-slate-300">
            Аккаунт HONOR
            <input
              value={config.account_id}
              onChange={(e) =>
                setConfig({ ...config, account_id: e.target.value })
              }
              className="mt-1 block w-full rounded bg-slate-800 p-2"
            />
          </label>
          <label className="text-xs text-slate-300">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig({ ...config, enabled: e.target.checked })
              }
            />{" "}
            Использовать подбор HONOR в этом аккаунте
          </label>
          {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
            <label key={k} className="block text-xs text-slate-300">
              {labels[k]}
              <textarea
                value={config.scenarios[k]}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scenarios: { ...config.scenarios, [k]: e.target.value },
                  })
                }
                rows={2}
                maxLength={1200}
                className="mt-1 block w-full rounded bg-slate-800 p-2"
              />
            </label>
          ))}
          <button
            disabled={busy}
            onClick={() =>
              void action({ action: "configure", channel, config })
            }
            className="rounded bg-blue-700 px-3 py-2 text-sm text-white"
          >
            Сохранить и оставить черновики
          </button>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Перед автоответом под личной учётной записью проверьте новый входящий
        тестового диалога, AI-черновик и ручной ответ. Затем нажмите
        «Подтвердить тест перехвата» под входящим. Это не включает автоответы.
      </p>
      <div className="space-y-2">
        <label className="block text-xs text-slate-300">
          Проверка без отправки клиентам
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1200}
            className="mt-1 block w-full rounded bg-slate-800 p-2"
          />
        </label>
        <button
          disabled={busy}
          onClick={() => void action({ action: "sandbox", channel, text })}
          className="rounded border border-blue-500 px-3 py-2 text-xs text-white"
        >
          {busy ? "Проверяем…" : "Подобрать по текущему каталогу"}
        </button>
        {answer && (
          <p className="whitespace-pre-wrap break-words text-xs text-slate-200">
            {answer}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              key={c.id}
              className="rounded-lg border border-slate-600 p-3 text-xs text-white"
            >
              {c.image && (
                /* eslint-disable-next-line @next/next/no-img-element */ <img
                  src={c.image}
                  alt={c.name}
                  className="mb-2 h-36 w-full object-contain"
                />
              )}
              {c.name}
              <p>{c.price.toLocaleString("ru-RU")} ₸</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
