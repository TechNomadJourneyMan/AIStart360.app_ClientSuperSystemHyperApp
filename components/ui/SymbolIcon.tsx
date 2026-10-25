import {
  Activity, ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp,
  BadgeCheck, BarChart3, Bell, BellOff, BookOpen, BriefcaseBusiness,
  CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Circle, CircleDot, CircleHelp, CircleUserRound, Clock3, CloudUpload,
  Database, Download, Ellipsis, Eye, EyeOff, FileCheck2, FileText, FileUp,
  Flag, FolderOpen, Globe, GraduationCap, Home, Languages, LayoutDashboard,
  Lightbulb, LoaderCircle, LockKeyhole, LogOut, Mail, Map, Menu, MessageCircle,
  MessageSquare, Minus, Network, PencilLine, Play, Plus, Radar, RefreshCw,
  Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2,
  TrendingUp, TriangleAlert, Upload, UserPlus, UserRound, Users, Volume2,
  VolumeX, Waypoints, X, Zap, Ban,
  type LucideIcon, type LucideProps,
} from 'lucide-react'

// The shared navigation used Material font ligatures. SVGs keep those controls
// legible even when an external font is unavailable or blocked by the CSP.
const symbols: Record<string, LucideIcon> = {
  account_circle: CircleUserRound, admin_panel_settings: ShieldCheck,
  analytics: BarChart3, arrow_back: ArrowLeft, arrow_downward: ArrowDown,
  arrow_forward: ArrowRight, arrow_upward: ArrowUp, assignment: FileText,
  auto_awesome: Sparkles, badge: BadgeCheck, bar_chart: BarChart3, block: Ban,
  bolt: Zap, business_center: BriefcaseBusiness, calendar_today: CalendarDays,
  campaign: Bell, check: Check, check_circle: CheckCircle2, check_circle_outline: CheckCircle2,
  chevron_left: ChevronLeft, chevron_right: ChevronRight, close: X,
  cloud_upload: CloudUpload, compare_arrows: ArrowLeftRight, dashboard: LayoutDashboard,
  database: Database, date_range: CalendarDays, delete: Trash2, description: FileText,
  done: Check, donut_small: Activity, download: Download, edit: PencilLine,
  edit_note: PencilLine, email: Mail, error: TriangleAlert, expand_less: ChevronUp,
  expand_more: ChevronDown, file_download: Download, flag: Flag, folder_open: FolderOpen,
  forum: MessageSquare, group: Users, groups: Users, help: CircleHelp,
  help_outline: CircleHelp, home: Home, hub: Network, info: CircleHelp,
  insights: TrendingUp, keyboard_arrow_down: ChevronDown, keyboard_arrow_left: ChevronLeft,
  keyboard_arrow_right: ChevronRight, keyboard_arrow_up: ChevronUp, language: Globe,
  lightbulb: Lightbulb, link: Waypoints, lock: LockKeyhole, login: ArrowRight, logout: LogOut,
  mail: Mail, manage_accounts: SlidersHorizontal, map: Map, menu: Menu,
  minimize: Minus, monitoring: Activity, more_horiz: Ellipsis, more_vert: Ellipsis,
  my_location: Target, notifications: Bell, notifications_active: Bell,
  notifications_off: BellOff, open_in_new: ArrowUp, person: UserRound,
  person_add: UserPlus, person_book: BookOpen, play_arrow: Play, psychology: Sparkles,
  public: Globe, query_stats: TrendingUp, radar: Radar,
  radio_button_checked: CircleDot, radio_button_unchecked: Circle, refresh: RefreshCw,
  report: FileCheck2, rocket_launch: TrendingUp, schedule: Clock3, school: GraduationCap,
  search: Search, send: ArrowRight, settings: Settings, shield: ShieldCheck,
  smart_toy: Sparkles, sync: RefreshCw, tips_and_updates: Lightbulb, tour: Map,
  translate: Languages, trending_up: TrendingUp, tune: SlidersHorizontal,
  upload: Upload, upload_file: FileUp, visibility: Eye, visibility_off: EyeOff,
  volume_off: VolumeX, volume_up: Volume2, warning: TriangleAlert,
  add: Plus, chat: MessageCircle, progress_activity: LoaderCircle,
}

export function SymbolIcon({ name, style, ...props }: LucideProps & { name: string }) {
  const Icon = symbols[name] ?? CircleHelp
  return <Icon aria-hidden="true" focusable="false" {...props} style={{ width: '1em', height: '1em', flexShrink: 0, ...style }} />
}
