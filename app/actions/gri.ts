'use server'

import { prisma } from "@/lib/db"
import { calculateGri, GriAnswers } from "@/lib/gri/logic"
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from "next/cache"

export async function createGriReportAction(clientId: string, answers: GriAnswers) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  try {
    const result = calculateGri(answers)

    const report = await prisma.griReport.create({
      data: {
        clientId,
        overallScore: result.overallScore,
        productScore: result.productScore,
        trustScore: result.trustScore,
        businessModelScore: result.businessModelScore,
        cashScore: result.cashScore,
        operationsScore: result.operationsScore,
        teamScore: result.teamScore,
        founderScore: result.founderScore,
        rawData: answers as any,
      }
    })

    revalidatePath("/pulse")
    revalidatePath(`/clients/${clientId}`)
    
    return { success: true, report }
  } catch (error) {
    console.error("Failed to create GRI report:", error)
    return { error: "Failed to save diagnostic report" }
  }
}

export async function getClientsAction() {
  const supabase = await createClient()
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser()
  if (!sessionUser) return []

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: sessionUser.id },
        { email: sessionUser.email ?? undefined },
      ],
    },
    select: { orgId: true }
  })

  if (!user?.orgId) return []

  return prisma.client.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: 'asc' }
  })
}
