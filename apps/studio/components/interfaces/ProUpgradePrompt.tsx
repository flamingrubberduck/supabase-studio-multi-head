import { ExternalLink, ShieldOff } from 'lucide-react'
import { Alert, Alert_Shadcn_, AlertDescription_Shadcn_, AlertTitle_Shadcn_ } from 'ui'

interface ProUpgradePromptProps {
  featureName: string
}

export function ProUpgradePrompt({ featureName }: ProUpgradePromptProps) {
  return (
    <Alert_Shadcn_ variant="default" className="border-warning/40 bg-warning-200">
      <ShieldOff className="h-4 w-4 text-warning-600" />
      <AlertTitle_Shadcn_ className="text-warning-700">Pro feature</AlertTitle_Shadcn_>
      <AlertDescription_Shadcn_ className="text-warning-600">
        {featureName} requires a Pro license.{' '}
        <a
          href="https://supabase-multihead.com/pricing"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-warning-700"
        >
          Upgrade to Pro <ExternalLink size={12} />
        </a>{' '}
        or set <code className="text-xs">MULTI_HEAD_LICENSE_KEY</code> in your <code className="text-xs">.env</code>.
      </AlertDescription_Shadcn_>
    </Alert_Shadcn_>
  )
}
