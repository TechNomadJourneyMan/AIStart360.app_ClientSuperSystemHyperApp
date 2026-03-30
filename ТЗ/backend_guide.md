# AIStart360 — Полное руководство по реализации Backend
> Версия: 1.0 | Март 2026 | Next.js 14 + Supabase + NextAuth

---

## ОГЛАВЛЕНИЕ

1. [Архитектура и стек](#1-архитектура-и-стек)
2. [Инициализация проекта](#2-инициализация-проекта)
3. [База данных — Supabase + Prisma](#3-база-данных)
4. [Аутентификация — NextAuth.js v5](#4-аутентификация)
5. [API Routes (Next.js)](#5-api-routes)
6. [Row Level Security (RLS)](#6-rls-безопасность)
7. [Загрузка файлов — Supabase Storage](#7-загрузка-файлов)
8. [Email уведомления — Resend](#8-email)
9. [Real-time уведомления](#9-real-time)
10. [Фоновые задачи — Inngest](#10-фоновые-задачи)
11. [Middleware и RBAC](#11-middleware-и-rbac)
12. [Деплой на Vercel](#12-деплой)
13. [Переход с mock на реальные данные](#13-переход-с-mock)

---

## 1. Архитектура и стек

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (Vercel)                  │
│  Next.js 14 App Router  │  React 18  │  TanStack    │
├─────────────────────────────────────────────────────┤
│                  API LAYER (Next.js)                 │
│  /app/api/*  (Route Handlers)  │  NextAuth.js v5    │
├─────────────────────────────────────────────────────┤
│                 DATA LAYER (Supabase)                │
│  PostgreSQL  │  Auth  │  Storage  │  Realtime       │
├─────────────────────────────────────────────────────┤
│               BACKGROUND (Inngest)                   │
│  GRI Calculation  │  Report Generation  │  Email    │
└─────────────────────────────────────────────────────┘
```

### Стек (финальный):

| Слой | Технология | Зачем |
|---|---|---|
| Framework | Next.js 14 (App Router) | Routing, SSR, API Routes |
| Language | TypeScript 5 | Type safety |
| Database | Supabase PostgreSQL | Managed DB + Auth + Storage + Realtime |
| ORM | Prisma 5 | Type-safe queries, migrations |
| Auth | NextAuth.js v5 (Auth.js) | JWT, sessions, OAuth |
| Email | Resend | Transactional email API |
| Jobs | Inngest | Background GRI calculation, reports |
| Cache | Upstash Redis | Rate limiting, session cache |
| Hosting | Vercel | Auto-deploy, Edge functions |

---

## 2. Инициализация проекта

### 2.1 Создать Supabase проект

```
1. Зайди на https://supabase.com/dashboard
2. New Project → выбери ближайший region (Europe West)
3. Запиши:
   - Project URL: https://xxxxx.supabase.co
   - anon key: eyJ...
   - service_role key: eyJ...  ← НИКОГДА не публикуй!
   - Database password
```

### 2.2 Установить зависимости backend

```bash
# В папке frontend/ (уже создан)
npm install next-auth@beta @auth/prisma-adapter
npm install prisma @prisma/client
npm install @supabase/supabase-js
npm install resend
npm install inngest
npm install @upstash/redis @upstash/ratelimit
npm install bcryptjs
npm install @types/bcryptjs -D

# Инициализировать Prisma
npx prisma init --datasource-provider postgresql
```

### 2.3 Заполнить .env.local

```bash
# Скопировать .env.example → .env.local
# Заполнить все переменные из разделов ниже
```

---

## 3. База данных

### 3.1 Prisma Schema (полная)

Создать файл `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")  // для Prisma migrations через Supabase
}

// ============================================================
// ENUMS
// ============================================================

enum UserRole {
  SUPER_ADMIN
  ADMIN
  MANAGER
  ANALYST
  CLIENT
}

enum ClientStatus {
  active
  at_risk
  inactive
  onboarding
}

enum GrowthStage {
  Seed
  Early
  Growth
  Scale
  Mature
}

enum SubscriptionPlan {
  free
  starter
  growth
  scale
  enterprise
}

enum NotificationType {
  gri_updated
  report
  alert
  project
  team
  system
}

enum NotificationPriority {
  urgent
  high
  medium
  low
}

// ============================================================
// MODELS
// ============================================================

model Organization {
  id        String           @id @default(cuid())
  name      String
  slug      String           @unique
  plan      SubscriptionPlan @default(free)
  logoUrl   String?

  users   User[]
  clients Client[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("organizations")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String?  // null если OAuth-only
  name         String
  role         UserRole @default(MANAGER)
  avatarUrl    String?
  lastLogin    DateTime?

  orgId  String
  org    Organization @relation(fields: [orgId], references: [id])

  // NextAuth required fields
  accounts Account[]
  sessions Session[]

  managedClients    Client[]       @relation("ManagedClients")
  uploadedReports   Report[]
  notifications     Notification[]
  activityLogs      ActivityLog[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

// NextAuth adapter tables
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

model Client {
  id       String       @id @default(cuid())
  name     String
  industry String
  stage    GrowthStage
  status   ClientStatus @default(active)
  website  String?
  notes    String?      @db.Text

  orgId     String
  org       Organization @relation(fields: [orgId], references: [id])
  managerId String
  manager   User         @relation("ManagedClients", fields: [managerId], references: [id])

  griReports   GriReport[]
  reports      Report[]
  projects     Project[]
  activityLogs ActivityLog[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("clients")
}

model GriReport {
  id             String   @id @default(cuid())
  clientId       String
  client         Client   @relation(fields: [clientId], references: [id])
  score          Int      // 0–1000
  // Domain scores stored as JSON:
  // { "strategy": 820, "finance": 760, "operations": 800,
  //   "team": 710, "market": 780, "technology": 690 }
  domains        Json
  benchmarkScore Int?
  version        String   @default("2.0")
  calculatedAt   DateTime @default(now())

  @@map("gri_reports")
}

model Report {
  id         String @id @default(cuid())
  clientId   String
  client     Client @relation(fields: [clientId], references: [id])
  uploadedBy String
  uploader   User   @relation(fields: [uploadedBy], references: [id])

  name     String
  category String // GRI, Financial, Growth, Market, Custom
  type     String // pdf, xlsx, csv, docx
  fileUrl  String
  fileSize Int    // bytes
  filePath String // Supabase Storage path

  uploadedAt DateTime @default(now())

  @@map("reports")
}

model Project {
  id          String    @id @default(cuid())
  clientId    String
  client      Client    @relation(fields: [clientId], references: [id])
  name        String
  status      String    @default("active") // active, in_review, completed, paused
  startDate   DateTime?
  endDate     DateTime?
  // Team allocations: [{ userId, allocationPct }]
  team        Json      @default("[]")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("projects")
}

model Notification {
  id       String               @id @default(cuid())
  userId   String
  user     User                 @relation(fields: [userId], references: [id])
  type     NotificationType
  priority NotificationPriority @default(medium)
  title    String
  body     String               @db.Text
  isRead   Boolean              @default(false)

  entityType String? // 'client', 'report', 'gri', 'project'
  entityId   String?

  createdAt DateTime @default(now())

  @@index([userId, isRead])
  @@map("notifications")
}

model ActivityLog {
  id         String  @id @default(cuid())
  userId     String
  user       User    @relation(fields: [userId], references: [id])
  clientId   String?
  client     Client? @relation(fields: [clientId], references: [id])
  action     String
  entityType String
  entityId   String
  metadata   Json    @default("{}")

  createdAt DateTime @default(now())

  @@index([clientId, createdAt])
  @@index([userId, createdAt])
  @@map("activity_logs")
}
```

### 3.2 Применить схему

```bash
# Push schema to Supabase (development)
npx prisma db push

# Generate Prisma Client
npx prisma generate

# Create migration (production)
npx prisma migrate dev --name init
```

### 3.3 Prisma Client singleton

Создать `lib/db.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

---

## 4. Аутентификация

### 4.1 NextAuth Config

Создать `lib/auth.ts`:

```typescript
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { prisma } from './db'
import type { UserRole } from '@/types'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 часа
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        })

        if (!user || !user.passwordHash) return null

        const passwordValid = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash
        )

        if (!passwordValid) return null

        // Update lastLogin
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          image: user.avatarUrl,
        }
      },
    }),

    // Google OAuth (опционально)
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // При первом логине добавляем role и orgId в token
      if (user) {
        token.role = (user as any).role as UserRole
        token.orgId = (user as any).orgId as string
      }
      return token
    },

    async session({ session, token }) {
      // Передаём role и orgId в session.user
      if (session.user) {
        session.user.id = token.sub!
        ;(session.user as any).role = token.role
        ;(session.user as any).orgId = token.orgId
      }
      return session
    },
  },
})
```

### 4.2 Auth Route Handler

Создать `app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
```

### 4.3 Подключить NextAuth в middleware.ts

Заменить mock в `middleware.ts` на реальную проверку:

```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((request) => {
  const { pathname } = request.nextUrl
  const isAuthenticated = !!request.auth

  const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password']
  const AUTH_ROUTES   = ['/login', '/register']

  if (isAuthenticated && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (!isAuthenticated && !PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

### 4.4 Заменить useAuth hook

Обновить `hooks/useAuth.ts`:

```typescript
'use client'

import { useSession } from 'next-auth/react'
import type { UserRole } from '@/types'

export function useAuth() {
  const { data: session, status } = useSession()

  return {
    user: session?.user ?? null,
    role: (session?.user as any)?.role as UserRole | undefined,
    orgId: (session?.user as any)?.orgId as string | undefined,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
  }
}
```

### 4.5 Регистрация пользователя

Создать `app/api/auth/register/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  name:     z.string().min(2),
  orgCode:  z.string().optional(), // invite code
})

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { email, password, name } = parsed.data

  // Проверить существующий email
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  // Найти или создать дефолтную организацию
  let org = await prisma.organization.findFirst({ where: { slug: 'default' } })
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Default Org', slug: 'default' }
    })
  }

  const user = await prisma.user.create({
    data: { email, passwordHash, name, orgId: org.id }
  })

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201 }
  )
}
```

---

## 5. API Routes

### 5.1 Структура

```
app/api/
├── auth/
│   ├── [...nextauth]/route.ts   ← NextAuth handler
│   └── register/route.ts
├── clients/
│   ├── route.ts                 ← GET list, POST create
│   └── [id]/
│       ├── route.ts             ← GET, PATCH, DELETE
│       └── gri/route.ts         ← GET gri reports
├── reports/
│   ├── route.ts                 ← GET list
│   └── upload/route.ts          ← POST upload
├── analytics/
│   └── overview/route.ts
├── notifications/
│   ├── route.ts                 ← GET list
│   └── [id]/read/route.ts       ← PATCH mark read
└── health/route.ts
```

### 5.2 Utility: API Auth Guard

Создать `lib/api-utils.ts`:

```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { UserRole } from '@/types'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { session }
}

export async function requireRole(...roles: UserRole[]) {
  const { session, error } = await requireAuth()
  if (error) return { error }

  const role = (session!.user as any).role as UserRole
  if (!roles.includes(role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { session: session!, role }
}
```

### 5.3 Clients API

Создать `app/api/clients/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { z } from 'zod'

// GET /api/clients
export async function GET(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const page   = parseInt(searchParams.get('page')  ?? '1')
  const limit  = parseInt(searchParams.get('limit') ?? '20')
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status')
  const orgId  = (session!.user as any).orgId

  const where = {
    orgId,
    ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    ...(status && { status: status as any }),
  }

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: {
        manager: { select: { id: true, name: true } },
        griReports: {
          orderBy: { calculatedAt: 'desc' },
          take: 1,
          select: { score: true, calculatedAt: true },
        },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.client.count({ where }),
  ])

  return NextResponse.json({ data: clients, meta: { total, page, limit } })
}

// POST /api/clients
const createSchema = z.object({
  name:      z.string().min(2),
  industry:  z.string(),
  stage:     z.enum(['Seed', 'Early', 'Growth', 'Scale', 'Mature']),
  managerId: z.string(),
  website:   z.string().url().optional(),
})

export async function POST(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const orgId = (session!.user as any).orgId

  const client = await prisma.client.create({
    data: {
      ...parsed.data,
      orgId,
    },
  })

  return NextResponse.json(client, { status: 201 })
}
```

Создать `app/api/clients/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

// GET /api/clients/:id
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      griReports: { orderBy: { calculatedAt: 'desc' }, take: 5 },
      reports: { orderBy: { uploadedAt: 'desc' }, take: 10 },
      projects: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json(client)
}

// PATCH /api/clients/:id
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const body = await request.json()

  const client = await prisma.client.update({
    where: { id: params.id },
    data: body,
  })

  return NextResponse.json(client)
}

// DELETE /api/clients/:id — soft delete
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  await prisma.client.update({
    where: { id: params.id },
    data: { status: 'inactive' },
  })

  return NextResponse.json({ success: true })
}
```

### 5.4 GRI API

Создать `app/api/clients/[id]/gri/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { inngest } from '@/lib/inngest'

// GET /api/clients/:id/gri
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const reports = await prisma.griReport.findMany({
    where: { clientId: params.id },
    orderBy: { calculatedAt: 'desc' },
    take: 10,
  })

  return NextResponse.json(reports)
}

// POST /api/clients/:id/gri/calculate
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  // Запустить фоновый расчёт
  await inngest.send({
    name: 'gri/calculate',
    data: { clientId: params.id },
  })

  return NextResponse.json({ message: 'GRI calculation queued' })
}
```

### 5.5 Reports Upload API

Создать `app/api/reports/upload/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const formData = await request.formData()
  const file     = formData.get('file') as File
  const clientId = formData.get('clientId') as string
  const category = formData.get('category') as string

  // Валидация
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })
  }

  // Upload to Supabase Storage
  const fileBuffer = await file.arrayBuffer()
  const fileName   = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const filePath   = `reports/${clientId}/${fileName}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('reports')
    .upload(filePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed', details: uploadError.message }, { status: 500 })
  }

  // Get public URL (signed, 24h)
  const { data: urlData } = supabase.storage.from('reports').createSignedUrl(filePath, 86400)

  // Save to DB
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'

  const report = await prisma.report.create({
    data: {
      clientId,
      uploadedBy: session!.user!.id!,
      name:     file.name.replace(`.${ext}`, ''),
      category: category || 'Custom',
      type:     ext,
      fileUrl:  urlData?.signedUrl ?? '',
      fileSize: file.size,
      filePath,
    },
  })

  return NextResponse.json(report, { status: 201 })
}
```

### 5.6 Notifications API

Создать `app/api/notifications/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

// GET /api/notifications
export async function GET(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const userId = session!.user!.id!
  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === 'true'

  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly && { isRead: false }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(notifications)
}
```

Создать `app/api/notifications/read-all/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

export async function PATCH() {
  const { session, error } = await requireAuth()
  if (error) return error

  await prisma.notification.updateMany({
    where: { userId: session!.user!.id!, isRead: false },
    data: { isRead: true },
  })

  return NextResponse.json({ success: true })
}
```

### 5.7 Health Check

Создать `app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch {
    return NextResponse.json({ status: 'error', db: 'disconnected' }, { status: 503 })
  }
}
```

---

## 6. RLS Безопасность

### 6.1 Включить RLS на всех таблицах

В Supabase Dashboard → SQL Editor выполнить:

```sql
-- Включить RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE gri_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Политика: пользователь видит только свои данные
CREATE POLICY "Users see own notifications"
  ON notifications FOR ALL
  USING (user_id = auth.uid());

-- Политика: пользователи видят только клиентов своей org
CREATE POLICY "Clients visible within org"
  ON clients FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM users WHERE id = auth.uid()
    )
  );

-- Политика: отчёты видны только в рамках org
CREATE POLICY "Reports visible within org"
  ON reports FOR ALL
  USING (
    client_id IN (
      SELECT id FROM clients WHERE org_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      )
    )
  );
```

### 6.2 Storage Bucket Policy

В Supabase → Storage → Policies:

```sql
-- Только аутентифицированные пользователи могут загружать
CREATE POLICY "Authenticated users can upload reports"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'reports'
    AND auth.role() = 'authenticated'
  );

-- Пользователи видят только файлы своей org
CREATE POLICY "Users can view org reports"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'reports'
    AND auth.role() = 'authenticated'
  );
```

---

## 7. Загрузка файлов

### 7.1 Создать bucket в Supabase

```
Supabase Dashboard → Storage → Create Bucket
  Name: reports
  Public: NO (private)
  File size limit: 52428800 (50MB)
  Allowed MIME types: application/pdf, application/vnd.openxmlformats...
```

### 7.2 Создать React компонент загрузки

Обновить страницу `/app/(dashboard)/reports/page.tsx` → добавить ReportUploader:

```typescript
'use client'

import { useState, useCallback } from 'react'
import { toast } from '@/stores/ui.store'

export function ReportUploader({ clientId }: { clientId?: string }) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    setProgress(0)

    const formData = new FormData()
    formData.append('file', file)
    if (clientId) formData.append('clientId', clientId)
    formData.append('category', 'Custom')

    try {
      const response = await fetch('/api/reports/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error('Upload failed')

      toast.success('Отчёт загружен', file.name)
      // TODO: invalidate reports query
    } catch (error) {
      toast.error('Ошибка загрузки', 'Попробуйте ещё раз')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }, [clientId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }, [handleUpload])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${isDragging ? 'border-primary/60 bg-primary/5' : 'border-outline-variant/30 hover:border-primary/30'}`}
    >
      {uploading ? (
        <div>
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-on-surface-variant">Загружаем...</p>
        </div>
      ) : (
        <>
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">cloud_upload</span>
          <p className="text-sm text-on-surface-variant">
            Перетащите или{' '}
            <label className="text-primary cursor-pointer hover:underline">
              выберите файл
              <input
                type="file"
                className="hidden"
                accept=".pdf,.xlsx,.csv,.docx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
              />
            </label>
          </p>
          <p className="text-xs text-on-surface-variant/50 mt-1">PDF, XLSX, CSV, DOCX — до 50MB</p>
        </>
      )}
    </div>
  )
}
```

---

## 8. Email

### 8.1 Создать `lib/email.ts`

```typescript
import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendNotificationEmail({
  to,
  subject,
  title,
  body,
  ctaLabel,
  ctaUrl,
}: {
  to: string
  subject: string
  title: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}) {
  const html = `
    <!DOCTYPE html>
    <html>
    <body style="background:#0A0B0F;color:#e3e2e8;font-family:DM Sans,sans-serif;padding:32px;max-width:500px;margin:0 auto">
      <div style="background:#1f1f24;border-radius:12px;padding:32px">
        <p style="color:#6effc0;font-size:11px;font-family:monospace;text-transform:uppercase;letter-spacing:0.2em;margin-bottom:16px">
          AIStart360 · Institutional Intelligence
        </p>
        <h1 style="font-size:22px;font-weight:700;margin:0 0 12px">${title}</h1>
        <p style="color:#bacbbf;line-height:1.6;margin:0 0 24px">${body}</p>
        ${ctaLabel && ctaUrl ? `
        <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#6effc0,#00e5a0);color:#003824;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none">
          ${ctaLabel}
        </a>
        ` : ''}
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0">
        <p style="color:#84958a;font-size:12px">
          AIStart360 — Institutional Intelligence Platform<br>
          Отписаться от уведомлений можно в настройках аккаунта.
        </p>
      </div>
    </body>
    </html>
  `

  return resend.emails.send({
    from: 'AIStart360 <notifications@aistart360.com>',
    to,
    subject,
    html,
  })
}
```

### 8.2 Использование

```typescript
// В любом API route
import { sendNotificationEmail } from '@/lib/email'

await sendNotificationEmail({
  to: 'user@company.com',
  subject: '⚠️ Critical Alert: Vortex Labs',
  title: 'Critical Alert Detected',
  body: 'GMV dropped 24% below threshold for Vortex Labs.',
  ctaLabel: 'Investigate',
  ctaUrl: 'https://app.aistart360.com/clients/1',
})
```

---

## 9. Real-time уведомления

### 9.1 Supabase Realtime Hook

Создать `hooks/useRealtimeNotifications.ts`:

```typescript
'use client'

import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useAuth } from './useAuth'
import type { Notification } from '@/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function useRealtimeNotifications() {
  const { user } = useAuth()
  const { addNotification } = useNotificationsStore()

  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Новое уведомление — добавить в store
          addNotification(payload.new as unknown as Notification)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, addNotification])
}
```

### 9.2 Подключить в dashboard layout

Обновить `app/(dashboard)/layout.tsx`:

```typescript
'use client'

import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications'
// ... остальные импорты

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  useRealtimeNotifications() // Подключает WebSocket

  return (
    // ... существующий JSX
  )
}
```

---

## 10. Фоновые задачи

### 10.1 Inngest Setup

Создать `lib/inngest.ts`:

```typescript
import { Inngest } from 'inngest'

export const inngest = new Inngest({ id: 'aistart360' })
```

### 10.2 GRI Calculation Function

Создать `lib/functions/calculate-gri.ts`:

```typescript
import { inngest } from '@/lib/inngest'
import { prisma } from '@/lib/db'

export const calculateGri = inngest.createFunction(
  {
    id: 'calculate-gri',
    throttle: { count: 10, period: '1m' }, // 10 расчётов в минуту
  },
  { event: 'gri/calculate' },

  async ({ event, step }) => {
    const { clientId } = event.data

    // Step 1: Получить данные клиента
    const client = await step.run('fetch-client', async () => {
      return prisma.client.findUnique({
        where: { id: clientId },
        include: { reports: { orderBy: { uploadedAt: 'desc' }, take: 5 } },
      })
    })

    if (!client) throw new Error(`Client ${clientId} not found`)

    // Step 2: Вычислить домены (здесь ваша бизнес-логика)
    const domains = await step.run('compute-domains', async () => {
      // TODO: реальный алгоритм расчёта по данным клиента
      return {
        strategy:   Math.round(600 + Math.random() * 400),
        finance:    Math.round(600 + Math.random() * 400),
        operations: Math.round(600 + Math.random() * 400),
        team:       Math.round(600 + Math.random() * 400),
        market:     Math.round(600 + Math.random() * 400),
        technology: Math.round(600 + Math.random() * 400),
      }
    })

    // Step 3: Weighted average → итоговый score
    const weights = { strategy: 0.2, finance: 0.2, operations: 0.15, team: 0.15, market: 0.15, technology: 0.15 }
    const score = Math.round(
      Object.entries(domains).reduce((sum, [key, val]) => {
        return sum + val * (weights[key as keyof typeof weights] ?? 0)
      }, 0)
    )

    // Step 4: Сохранить результат
    const report = await step.run('save-report', async () => {
      return prisma.griReport.create({
        data: { clientId, score, domains }
      })
    })

    // Step 5: Уведомить менеджера
    await step.run('notify', async () => {
      const manager = await prisma.user.findFirst({
        where: { managedClients: { some: { id: clientId } } }
      })
      if (manager) {
        await prisma.notification.create({
          data: {
            userId: manager.id,
            type: 'gri_updated',
            priority: 'medium',
            title: `GRI Updated: ${client.name}`,
            body: `New GRI Score: ${score}/1000. ${score >= 800 ? 'Excellent performance!' : 'Review recommended.'}`,
            entityType: 'gri',
            entityId: report.id,
          }
        })
      }
    })

    return { clientId, score, domains }
  }
)
```

### 10.3 Inngest Route

Создать `app/api/inngest/route.ts`:

```typescript
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { calculateGri } from '@/lib/functions/calculate-gri'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [calculateGri],
})
```

---

## 11. Middleware и RBAC

### 11.1 Server-side Role Check

Создать `lib/rbac.ts`:

```typescript
import { auth } from './auth'
import { redirect } from 'next/navigation'
import type { UserRole } from '@/types'

// Использовать в Server Components и Route Handlers
export async function requireServerRole(...roles: UserRole[]) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  const userRole = (session.user as any).role as UserRole
  if (!roles.includes(userRole)) {
    redirect('/403')
  }

  return session
}
```

### 11.2 Пример использования в Server Component

```typescript
// app/(dashboard)/team/page.tsx
import { requireServerRole } from '@/lib/rbac'

export default async function TeamPage() {
  // Проверяет роль на сервере перед рендером
  await requireServerRole('ADMIN', 'SUPER_ADMIN')

  // ... остальной код страницы
}
```

### 11.3 Rate Limiting

Создать `lib/rate-limit.ts`:

```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// 10 запросов в минуту на auth endpoints
export const authRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1m'),
  analytics: true,
})

// Использование в API route:
// const identifier = request.ip ?? 'anonymous'
// const { success } = await authRateLimit.limit(identifier)
// if (!success) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
```

---

## 12. Деплой

### 12.1 Vercel Setup

```bash
# Установить Vercel CLI
npm i -g vercel

# Залогиниться
vercel login

# Деплой из папки frontend/
cd frontend
vercel

# Production деплой
vercel --prod
```

### 12.2 Vercel Environment Variables

В Vercel Dashboard → Project → Settings → Environment Variables добавить:

```
NEXTAUTH_URL               = https://app.aistart360.com
NEXTAUTH_SECRET            = [сгенерировать: openssl rand -base64 32]
DATABASE_URL               = postgresql://...supabase...
DIRECT_URL                 = postgresql://...supabase... (без pgBouncer)
NEXT_PUBLIC_SUPABASE_URL   = https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
SUPABASE_SERVICE_ROLE_KEY  = eyJ...
RESEND_API_KEY             = re_...
GOOGLE_CLIENT_ID           = ...
GOOGLE_CLIENT_SECRET       = ...
INNGEST_EVENT_KEY          = ...
INNGEST_SIGNING_KEY        = ...
```

### 12.3 Supabase Production Settings

```
1. Supabase Dashboard → Project → Settings → Database
2. Connection pooling: включить pgBouncer
3. DATABASE_URL = connection pooler URL (порт 6543)
4. DIRECT_URL = direct URL (порт 5432) — для Prisma migrations

5. Auth → URL Configuration:
   Site URL: https://app.aistart360.com
   Redirect URLs: https://app.aistart360.com/api/auth/callback/google

6. Storage → Create bucket 'reports' (private)

7. Realtime → Publications → Enable для таблицы notifications
```

### 12.4 GitHub Actions CI/CD

Создать `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./frontend

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run type-check

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
        env:
          NEXTAUTH_URL: http://localhost:3000
          NEXTAUTH_SECRET: test-secret-key-for-ci-minimum-32-chars
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
          DATABASE_URL: postgresql://placeholder

# Vercel деплоит автоматически через GitHub integration
# Настроить: Vercel Dashboard → Project → Git → Connect Repository
```

---

## 13. Переход с mock на реальные данные

Весь фронтенд сейчас использует `lib/mock-data.ts`. Вот пошаговый план перехода:

### Шаг 1: Добавить TanStack Query хуки

Создать `hooks/useClients.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Client } from '@/types'

// Fetch helper
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// GET /api/clients
export function useClients(filters?: { search?: string; status?: string }) {
  const params = new URLSearchParams(filters as any)
  return useQuery<{ data: Client[]; meta: { total: number } }>({
    queryKey: ['clients', filters],
    queryFn: () => fetchJson(`/api/clients?${params}`),
  })
}

// GET /api/clients/:id
export function useClient(id: string) {
  return useQuery<Client>({
    queryKey: ['clients', id],
    queryFn: () => fetchJson(`/api/clients/${id}`),
    enabled: !!id,
  })
}

// POST /api/clients
export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Client>) =>
      fetchJson('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })
}
```

### Шаг 2: Обновить компоненты

Замена в `components/clients/ClientsTable.tsx`:

```typescript
// БЫЛО:
import { MOCK_CLIENTS } from '@/lib/mock-data'
const clients = MOCK_CLIENTS

// СТАЛО:
import { useClients } from '@/hooks/useClients'
const { data, isLoading, isError } = useClients()
const clients = data?.data ?? []
```

### Шаг 3: Порядок обновления компонентов

```
Приоритет 1 (критический путь):
  ✅ Login → NextAuth signIn()
  ✅ Clients List → useClients()
  ✅ Client Detail → useClient(id)

Приоритет 2 (core features):
  ✅ GRI Display → useGri(clientId)
  ✅ Reports List → useReports()
  ✅ Notifications → useNotifications()

Приоритет 3 (enhancement):
  ✅ Dashboard KPIs → useAnalytics()
  ✅ Team → useTeam()
  ✅ Intelligence → useSignals()
```

### Шаг 4: Seed начальных данных

Создать `prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Создать организацию
  const org = await prisma.organization.upsert({
    where: { slug: 'aistart360' },
    create: { name: 'AIStart360', slug: 'aistart360', plan: 'growth' },
    update: {},
  })

  // Создать admin пользователя
  const passwordHash = await bcrypt.hash('Admin1234!', 12)
  await prisma.user.upsert({
    where: { email: 'admin@aistart360.com' },
    create: {
      email: 'admin@aistart360.com',
      passwordHash,
      name: 'Admin User',
      role: 'ADMIN',
      orgId: org.id,
    },
    update: {},
  })

  // Создать тестового manager
  const manager = await prisma.user.upsert({
    where: { email: 'manager@aistart360.com' },
    create: {
      email: 'manager@aistart360.com',
      passwordHash: await bcrypt.hash('Manager1234!', 12),
      name: 'Alex Kim',
      role: 'MANAGER',
      orgId: org.id,
    },
    update: {},
  })

  // Создать тестовых клиентов
  for (const c of [
    { name: 'Vortex Labs', industry: 'FinTech', stage: 'Scale' as const },
    { name: 'Calyx Digital', industry: 'E-commerce', stage: 'Growth' as const },
    { name: 'Nexum Systems', industry: 'SaaS', stage: 'Growth' as const },
  ]) {
    await prisma.client.create({
      data: { ...c, orgId: org.id, managerId: manager.id }
    })
  }

  console.log('✅ Seed completed')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

Добавить в `package.json`:

```json
"prisma": {
  "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
}
```

Запустить: `npx prisma db seed`

---

## Итоговый чеклист запуска

```
Infrastructure:
  ☐ Supabase проект создан
  ☐ Все env vars заполнены в .env.local
  ☐ Prisma schema pushed: npx prisma db push
  ☐ Seed data загружен: npx prisma db seed
  ☐ Supabase Storage bucket 'reports' создан (private)
  ☐ RLS включён на всех таблицах
  ☐ Realtime enabled для таблицы notifications

Authentication:
  ☐ NextAuth установлен и настроен
  ☐ login/register страницы подключены к реальному signIn
  ☐ Middleware обновлён на auth()
  ☐ useAuth hook подключён к useSession

API:
  ☐ Все route handlers созданы
  ☐ Auth guard на всех protected routes
  ☐ Клиенты, отчёты, GRI — реальные данные из БД

Frontend:
  ☐ TanStack Query hooks созданы для всех entities
  ☐ mock-data.ts заменён на API calls
  ☐ Loading/Error states везде работают
  ☐ Toast notifications работают

Email:
  ☐ Resend API key настроен
  ☐ Тестовое письмо отправлено

Background Jobs:
  ☐ Inngest настроен
  ☐ GRI calculation function создана
  ☐ /api/inngest route создан

Deploy:
  ☐ Vercel project создан
  ☐ Env vars добавлены в Vercel
  ☐ GitHub integration подключён
  ☐ Custom domain настроен (app.aistart360.com)
  ☐ HTTPS работает (автоматически Vercel)
```

---

*Backend guide создан как инструкция для разработчика. Весь фронтенд-код уже создан в `/AI-Portal/frontend/` и готов к подключению.*
