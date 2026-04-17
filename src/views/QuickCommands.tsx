import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play,
  Plus,
  Pencil,
  Trash2,
  Terminal,
  FileCode,
  ChevronDown,
  ChevronUp,
  X,
  FolderOpen,
  Loader2,
  GripVertical,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import * as api from "../lib/tauri";
import type { QuickCommand, ExecutionResult } from "../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

// ── CommandCard ──

function CommandCard({
  cmd,
  executing,
  lastResult,
  expandedOutput,
  onToggleOutput,
  onExecute,
  onEdit,
  onDelete,
  dragProvided,
}: {
  cmd: QuickCommand;
  executing: boolean;
  lastResult: ExecutionResult | null;
  expandedOutput: boolean;
  onToggleOutput: () => void;
  onExecute: () => void;
  onEdit: () => void;
  onDelete: () => void;
  dragProvided: {
    innerRef: (el: HTMLElement | null) => void;
    draggableProps: Record<string, unknown>;
    dragHandleProps: Record<string, unknown> | null;
  };
}) {
  const { t } = useTranslation();
  const typeIcon = cmd.type === "shell" ? Terminal : FileCode;
  const TypeIcon = typeIcon;
  const preview =
    cmd.type === "shell"
      ? cmd.command
      : cmd.script_path
        ? cmd.script_path
        : cmd.script_content
          ? cmd.script_content.slice(0, 80)
          : "";

  return (
    <div
      ref={dragProvided.innerRef}
      {...dragProvided.draggableProps}
      className="group bg-surface rounded-lg border border-border hover:border-border-hover transition-colors"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Drag handle */}
        <div
          {...dragProvided.dragHandleProps}
          className="text-faint cursor-grab active:cursor-grabbing shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Type icon */}
        <TypeIcon className="w-4 h-4 text-muted shrink-0" />

        {/* Name & preview */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-primary truncate">{cmd.name}</div>
          {preview && (
            <div className="text-xs text-tertiary truncate font-mono mt-0.5">{preview}</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onExecute}
            disabled={executing}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              executing
                ? "text-muted cursor-wait"
                : "text-accent hover:bg-accent-bg"
            )}
            title={t("quickCommands.execute")}
          >
            {executing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
          {lastResult && (
            <button
              onClick={onToggleOutput}
              className="p-1.5 rounded-md text-muted hover:bg-surface-hover transition-colors"
              title={t("quickCommands.toggleOutput")}
            >
              {expandedOutput ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md text-faint hover:text-secondary hover:bg-surface-hover transition-colors"
            title={t("common.rename")}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-faint hover:text-red-400 hover:bg-surface-hover transition-colors"
            title={t("common.delete")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Output panel */}
      {expandedOutput && lastResult && (
        <div className="border-t border-border px-3 py-2.5 bg-bg-secondary">
          <div className="flex items-center justify-between mb-1.5">
            <span
              className={cn(
                "text-xs font-medium",
                lastResult.exit_code === 0 ? "text-emerald-500" : "text-red-500"
              )}
            >
              {t("quickCommands.exitCode", { code: lastResult.exit_code })}
            </span>
            <button
              onClick={onToggleOutput}
              className="text-faint hover:text-secondary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {lastResult.stdout && (
            <pre className="text-xs font-mono text-secondary whitespace-pre-wrap break-all mb-1.5 max-h-40 overflow-y-auto">
              {lastResult.stdout}
            </pre>
          )}
          {lastResult.stderr && (
            <pre className="text-xs font-mono text-red-400/80 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {lastResult.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── CommandEditorDialog ──

function CommandEditorDialog({
  cmd,
  onSave,
  onClose,
}: {
  cmd: QuickCommand | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = cmd !== null;

  const [name, setName] = useState(cmd?.name ?? "");
  const [type, setType] = useState<"shell" | "script">(cmd?.type === "script" ? "script" : "shell");
  const [command, setCommand] = useState(cmd?.command ?? "");
  const [scriptSource, setScriptSource] = useState<"inline" | "file">(
    cmd?.script_path ? "file" : "inline"
  );
  const [scriptExt, setScriptExt] = useState(cmd?.script_ext ?? "sh");
  const [scriptContent, setScriptContent] = useState(cmd?.script_content ?? "");
  const [scriptPath, setScriptPath] = useState(cmd?.script_path ?? "");
  const [workingDir, setWorkingDir] = useState(cmd?.working_dir ?? "");
  const [saving, setSaving] = useState(false);

  const handleBrowseScript = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Scripts", extensions: ["sh", "py", "js", "ts"] },
        { name: "All", extensions: ["*"] },
      ],
    });
    if (selected) {
      setScriptPath(selected);
      const ext = selected.split(".").pop() ?? "sh";
      setScriptExt(ext);
    }
  };

  const handleBrowseDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setWorkingDir(selected);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("quickCommands.nameRequired"));
      return;
    }
    if (type === "shell" && !command.trim()) {
      toast.error(t("quickCommands.commandRequired"));
      return;
    }
    if (type === "script" && scriptSource === "inline" && !scriptContent.trim()) {
      toast.error(t("quickCommands.scriptContentRequired"));
      return;
    }
    if (type === "script" && scriptSource === "file" && !scriptPath.trim()) {
      toast.error(t("quickCommands.scriptPathRequired"));
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await api.updateQuickCommand(
          cmd.id,
          name.trim(),
          type,
          type === "shell" ? command.trim() : null,
          type === "script" ? scriptExt : null,
          type === "script" && scriptSource === "inline" ? scriptContent : null,
          type === "script" && scriptSource === "file" ? scriptPath : null,
          workingDir || null,
          null,
          null
        );
      } else {
        await api.createQuickCommand(
          name.trim(),
          type,
          type === "shell" ? command.trim() : null,
          type === "script" ? scriptExt : null,
          type === "script" && scriptSource === "inline" ? scriptContent : null,
          type === "script" && scriptSource === "file" ? scriptPath : null,
          workingDir || null,
          null,
          null
        );
      }
      toast.success(isEdit ? t("quickCommands.updated") : t("quickCommands.created"));
      onSave();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-lg shadow-xl border border-border max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-primary">
            {isEdit ? t("quickCommands.editCommand") : t("quickCommands.addCommand")}
          </h2>
          <button onClick={onClose} className="text-faint hover:text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t("quickCommands.commandName")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("quickCommands.commandNamePlaceholder")}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-secondary text-primary placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </div>

          {/* Type toggle */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t("quickCommands.commandType")}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setType("shell")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors",
                  type === "shell"
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-border text-tertiary hover:border-border-hover"
                )}
              >
                <Terminal className="w-3.5 h-3.5" />
                {t("quickCommands.typeShell")}
              </button>
              <button
                onClick={() => setType("script")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors",
                  type === "script"
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-border text-tertiary hover:border-border-hover"
                )}
              >
                <FileCode className="w-3.5 h-3.5" />
                {t("quickCommands.typeScript")}
              </button>
            </div>
          </div>

          {/* Shell command */}
          {type === "shell" && (
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                {t("quickCommands.shellCommand")}
              </label>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t("quickCommands.shellCommandPlaceholder")}
                rows={3}
                className="w-full px-3 py-2 text-sm font-mono rounded-md border border-border bg-bg-secondary text-primary placeholder:text-faint focus:outline-none focus:border-accent resize-y"
              />
            </div>
          )}

          {/* Script config */}
          {type === "script" && (
            <>
              {/* Script source toggle */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  {t("quickCommands.scriptSource")}
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setScriptSource("inline")}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-md border transition-colors",
                      scriptSource === "inline"
                        ? "border-accent bg-accent-bg text-accent"
                        : "border-border text-tertiary hover:border-border-hover"
                    )}
                  >
                    {t("quickCommands.sourceInline")}
                  </button>
                  <button
                    onClick={() => setScriptSource("file")}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-md border transition-colors",
                      scriptSource === "file"
                        ? "border-accent bg-accent-bg text-accent"
                        : "border-border text-tertiary hover:border-border-hover"
                    )}
                  >
                    {t("quickCommands.sourceFile")}
                  </button>
                </div>
              </div>

              {/* Language selector */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  {t("quickCommands.scriptLanguage")}
                </label>
                <select
                  value={scriptExt}
                  onChange={(e) => setScriptExt(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-secondary text-primary focus:outline-none focus:border-accent"
                >
                  <option value="sh">Shell (sh)</option>
                  <option value="py">Python (py)</option>
                  <option value="js">JavaScript (js)</option>
                </select>
              </div>

              {/* Inline content */}
              {scriptSource === "inline" && (
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">
                    {t("quickCommands.scriptContent")}
                  </label>
                  <textarea
                    value={scriptContent}
                    onChange={(e) => setScriptContent(e.target.value)}
                    placeholder={t("quickCommands.scriptContentPlaceholder")}
                    rows={6}
                    className="w-full px-3 py-2 text-sm font-mono rounded-md border border-border bg-bg-secondary text-primary placeholder:text-faint focus:outline-none focus:border-accent resize-y"
                  />
                </div>
              )}

              {/* File path */}
              {scriptSource === "file" && (
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">
                    {t("quickCommands.scriptFilePath")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={scriptPath}
                      onChange={(e) => setScriptPath(e.target.value)}
                      placeholder={t("quickCommands.scriptFilePathPlaceholder")}
                      className="flex-1 px-3 py-2 text-sm font-mono rounded-md border border-border bg-bg-secondary text-primary placeholder:text-faint focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={handleBrowseScript}
                      className="px-3 py-2 text-sm rounded-md border border-border text-secondary hover:bg-surface-hover transition-colors shrink-0"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Working directory */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t("quickCommands.workingDir")}
            </label>
            <div className="flex gap-2">
              <input
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder={t("quickCommands.workingDirPlaceholder")}
                className="flex-1 px-3 py-2 text-sm rounded-md border border-border bg-bg-secondary text-primary placeholder:text-faint focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleBrowseDir}
                className="px-3 py-2 text-sm rounded-md border border-border text-secondary hover:bg-surface-hover transition-colors shrink-0"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-secondary hover:bg-surface-hover transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isEdit ? (
              t("common.save")
            ) : (
              t("common.create")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── QuickCommands (main page) ──

export function QuickCommands() {
  const { t } = useTranslation();
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingCmd, setEditingCmd] = useState<QuickCommand | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ cmdId: string; result: ExecutionResult } | null>(null);
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuickCommand | null>(null);
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());

  const refreshCommands = useCallback(async () => {
    try {
      const cmds = await api.getQuickCommands();
      setCommands(cmds);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refreshCommands();
  }, [refreshCommands]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const reordered = [...commands];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setCommands(reordered);

    reorderQueueRef.current = reorderQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await api.reorderQuickCommands(reordered.map((c) => c.id));
        } catch {
          await refreshCommands();
          toast.error(t("common.error"));
        }
      });
  };

  const handleExecute = async (cmd: QuickCommand) => {
    setExecuting(cmd.id);
    setLastResult(null);
    try {
      const result = await api.executeQuickCommand(cmd.id);
      setLastResult({ cmdId: cmd.id, result });
      setExpandedOutput(cmd.id);
      if (result.exit_code === 0) {
        toast.success(t("quickCommands.execSuccess", { name: cmd.name }));
      } else {
        toast.error(t("quickCommands.execFailed", { name: cmd.name, code: result.exit_code }));
      }
    } catch {
      toast.error(t("quickCommands.execError", { name: cmd.name }));
    } finally {
      setExecuting(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteQuickCommand(deleteTarget.id);
      await refreshCommands();
      toast.success(t("quickCommands.deleted"));
    } catch {
      toast.error(t("common.error"));
    }
    setDeleteTarget(null);
  };

  const handleEdit = (cmd: QuickCommand) => {
    setEditingCmd(cmd);
    setShowEditor(true);
  };

  const handleAdd = () => {
    setEditingCmd(null);
    setShowEditor(true);
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingCmd(null);
  };

  const handleEditorSave = async () => {
    await refreshCommands();
    setShowEditor(false);
    setEditingCmd(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-primary">{t("quickCommands.title")}</h1>
          <p className="text-sm text-tertiary mt-0.5">{t("quickCommands.subtitle")}</p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("quickCommands.addCommand")}
        </button>
      </div>

      {/* Command List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {commands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted">
            <Terminal className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">{t("quickCommands.empty")}</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="quick-commands">
              {(provided) => (
                <div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
                  {commands.map((cmd, index) => (
                    <Draggable key={cmd.id} draggableId={cmd.id} index={index}>
                      {(dragProvided) => (
                        <CommandCard
                          cmd={cmd}
                          executing={executing === cmd.id}
                          lastResult={lastResult?.cmdId === cmd.id ? lastResult.result : null}
                          expandedOutput={expandedOutput === cmd.id}
                          onToggleOutput={() =>
                            setExpandedOutput(expandedOutput === cmd.id ? null : cmd.id)
                          }
                          onExecute={() => handleExecute(cmd)}
                          onEdit={() => handleEdit(cmd)}
                          onDelete={() => setDeleteTarget(cmd)}
                          dragProvided={dragProvided}
                        />
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {/* Editor Dialog */}
      {showEditor && (
        <CommandEditorDialog
          cmd={editingCmd}
          onSave={handleEditorSave}
          onClose={handleEditorClose}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 border border-border">
            <p className="text-sm text-primary mb-4">
              {t("quickCommands.deleteConfirm", { name: deleteTarget.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-sm rounded-md border border-border text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-sm rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
