'use server'

import { prisma } from "@/lib/db"
import { calculateGri, GriAnswers } from "@/lib/gri/logic"
import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"

export async function createGriReportAction(clientId: string, answers: GriAnswers) {
  const session = await auth()
  if (!session?.user) {
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
  const session = await auth()
  if (!session?.user) return []

  // Assuming user can see clients of their organization
  const user = await prisma.user.findUnique({
    where: { id: session.user.id as string },
    select: { orgId: true }
  })

  if (!user?.orgId) return []

  return prisma.client.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: 'asc' }
  })
}
