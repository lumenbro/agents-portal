'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ApiKeyInfo {
  id: string;
  prefix: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
  status: 'active' | 'revoked';
}

interface ApiKeyTableProps {
  keys: ApiKeyInfo[];
  onRevoke?: (id: string) => void;
}

export function ApiKeyTable({ keys, onRevoke }: ApiKeyTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const handleCopy = async (prefix: string, id: string) => {
    await navigator.clipboard.writeText(prefix);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRevoke = () => {
    if (revokeTarget) {
      onRevoke?.(revokeTarget.id);
      setRevokeTarget(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (keys.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">No API keys yet. Add an agent to generate one.</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Key Prefix
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Created
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Last Used
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="py-3 px-4">
                  <span className="text-sm font-medium">{key.name}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                      {revealedId === key.id ? key.prefix : `${key.prefix.slice(0, 8)}${'*'.repeat(24)}`}
                    </code>
                    <button
                      onClick={() => setRevealedId(revealedId === key.id ? null : key.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {revealedId === key.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => handleCopy(key.prefix, key.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedId === key.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm text-muted-foreground">
                  {formatDate(key.createdAt)}
                </td>
                <td className="py-3 px-4 text-sm text-muted-foreground">
                  {key.lastUsed ? formatDate(key.lastUsed) : 'Never'}
                </td>
                <td className="py-3 px-4">
                  <Badge variant={key.status === 'active' ? 'success' : 'destructive'}>
                    {key.status}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-right">
                  {key.status === 'active' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRevokeTarget(key)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke the key &quot;{revokeTarget?.name}&quot;? This action
              cannot be undone. Any agents using this key will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke}>
              Revoke Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
