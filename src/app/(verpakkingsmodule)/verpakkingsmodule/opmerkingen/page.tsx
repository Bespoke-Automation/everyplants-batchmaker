import { Suspense } from 'react'
import CommentsPage from '@/components/verpakking/CommentsPage'

export default function OpmerkingenPage() {
  return (
    <Suspense>
      <CommentsPage />
    </Suspense>
  )
}
