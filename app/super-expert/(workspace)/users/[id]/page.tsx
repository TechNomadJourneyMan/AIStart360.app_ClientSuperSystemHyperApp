import { User360Page } from '@/components/giga-panel/pages/User360Page'

export default function Page({ params }: { params: { id: string } }) {
  return <User360Page params={params} />
}
