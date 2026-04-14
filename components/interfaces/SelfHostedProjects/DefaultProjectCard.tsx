import { useRouter } from 'next/router'
import { Card, CardContent, CardFooter, Button, Badge } from 'ui'
import { Database, Code } from 'lucide-react'

import { DEFAULT_PROJECT } from '@/lib/constants/api'

export default function DefaultProjectCard() {
  const router = useRouter()

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="mt-0.5 size-2 shrink-0 rounded-full bg-brand" />
          <h3 className="text-sm font-medium truncate">{DEFAULT_PROJECT.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-xs">
            Active
          </Badge>
          <span className="text-xs text-foreground-lighter font-mono">{DEFAULT_PROJECT.ref}</span>
        </div>
        <p className="text-xs text-foreground-light">Default project (env vars)</p>
      </CardContent>

      <CardFooter className="gap-2 mt-auto pt-0">
        <Button
          type="default"
          size="small"
          icon={<Database size={14} />}
          onClick={() => router.push(`/project/${DEFAULT_PROJECT.ref}/editor`)}
          className="flex-1"
        >
          Table editor
        </Button>
        <Button
          type="default"
          size="small"
          icon={<Code size={14} />}
          onClick={() => router.push(`/project/${DEFAULT_PROJECT.ref}/sql/new`)}
          className="flex-1"
        >
          SQL editor
        </Button>
      </CardFooter>
    </Card>
  )
}
