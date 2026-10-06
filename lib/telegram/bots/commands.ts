/**
 * Bot command lists for setMyCommands (scripts/telegram/set-webhooks.ts) and
 * the bots' own /command routing. Dependency-free so the setup script can
 * import it without the app runtime.
 */
export interface BotCommand { command: string; description: string }

export const ADMIN_COMMANDS: BotCommand[] = [
  { command: 'menu', description: 'Главное меню' },
  { command: 'status', description: 'Статус платформы' },
  { command: 'agents', description: 'ИИ-агенты и задачи' },
  { command: 'approvals', description: 'Одобрения действий агентов' },
  { command: 'users', description: 'Пользователи и заявки на доступ' },
  { command: 'clients', description: 'Клиенты и компании' },
  { command: 'reports', description: 'Отчёты и проверка выводов ИИ' },
  { command: 'providers', description: 'Провайдеры ИИ и ключи' },
  { command: 'spend', description: 'Расходы и лимиты ИИ' },
  { command: 'notifications', description: 'Мои уведомления' },
  { command: 'mcp', description: 'MCP-доступ: токены для Claude Code' },
  { command: 'cancel', description: 'Отменить ввод' },
]

export const EXPERT_COMMANDS: BotCommand[] = [
  { command: 'menu', description: 'Главное меню' },
  { command: 'clients', description: 'Клиенты' },
  { command: 'diagnostics', description: 'Последние диагностики' },
  { command: 'reports', description: 'Опубликованные отчёты' },
  { command: 'notifications', description: 'Мои уведомления' },
  { command: 'cancel', description: 'Отменить ввод' },
]

export const CLIENT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Привязать чат к кабинету AIStart360' },
]
