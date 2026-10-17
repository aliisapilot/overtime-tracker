import React, { useState, useEffect } from 'react';

export type DeleteActionType =
  | 'archive_employee'
  | 'restore_employee'
  | 'archive_site'
  | 'restore_site'
  | 'void_shift'
  | 'void_overtime'
  | 'purge_photo';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  actionType: DeleteActionType;
  recordId: string;
  recordTitle: string;
  subtitle?: string;
  isSubmitting: boolean;
  onConfirm: (reason: string, policyAck?: boolean) => Promise<void>;
  onClose: () => void;
}

export default function ConfirmDeleteModal({
  isOpen,
  actionType,
  recordId,
  recordTitle,
  subtitle,
  isSubmitting,
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const [reason, setReason] = useState('');
  const [policyAck, setPolicyAck] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setPolicyAck(false);
      setValidationError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isMandatoryReason =
    actionType === 'void_shift' || actionType === 'void_overtime' || actionType === 'purge_photo';
  const isPhotoPurge = actionType === 'purge_photo';
  const isRestore = actionType.startsWith('restore_');

  const config: Record<
    DeleteActionType,
    {
      badge: string;
      badgeColor: string;
      title: string;
      confirmBtnText: string;
      confirmBtnColor: string;
      warningText: string;
      reasonPlaceholder: string;
    }
  > = {
    archive_employee: {
      badge: 'ARCHIVE EMPLOYEE',
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      title: `Archive Employee ${recordId}`,
      confirmBtnText: 'Archive Employee',
      confirmBtnColor: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30',
      warningText:
        'Archiving this employee soft-deletes their profile from the active workforce and blocks login or shift start. All historical attendance, overtime, and audit logs are safely preserved and can be restored at any time.',
      reasonPlaceholder: 'Reason for archiving (e.g. Contract ended, resigned, duplicate profile)...',
    },
    restore_employee: {
      badge: 'RESTORE EMPLOYEE',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      title: `Restore Employee ${recordId}`,
      confirmBtnText: 'Restore to Active',
      confirmBtnColor: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30',
      warningText:
        'This employee will be restored to Active status, allowing them to log in and clock in for shifts at assigned job sites.',
      reasonPlaceholder: 'Optional note for restoring employee...',
    },
    archive_site: {
      badge: 'ARCHIVE JOB SITE',
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      title: `Archive Job Site ${recordId}`,
      confirmBtnText: 'Archive Job Site',
      confirmBtnColor: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30',
      warningText:
        'Archiving this job site prevents new shift clock-ins and new worker assignments. Active shifts must be completed before archiving. Historical shifts and GPS logs remain permanently preserved.',
      reasonPlaceholder: 'Reason for archiving (e.g. Project handover complete, inactive location)...',
    },
    restore_site: {
      badge: 'RESTORE JOB SITE',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      title: `Restore Job Site ${recordId}`,
      confirmBtnText: 'Restore to Active',
      confirmBtnColor: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30',
      warningText:
        'This job site will be restored to Active status and will be available for new shifts and employee assignments.',
      reasonPlaceholder: 'Optional note for restoring site...',
    },
    void_shift: {
      badge: 'VOID ATTENDANCE RECORD',
      badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      title: `Void Shift ${recordId}`,
      confirmBtnText: 'Void Attendance Shift',
      confirmBtnColor: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30',
      warningText:
        'This attendance record will be marked as Voided and excluded from working hours, daily reports, and active attendance totals. Any associated pending overtime will be automatically cancelled. Original values remain preserved for audit.',
      reasonPlaceholder: 'Mandatory reason for voiding this shift (e.g. Accidental supervisor test entry, clock-in on wrong site)...',
    },
    void_overtime: {
      badge: 'CANCEL / VOID OVERTIME',
      badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      title: `Cancel Overtime Record ${recordId}`,
      confirmBtnText: 'Cancel Overtime',
      confirmBtnColor: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30',
      warningText:
        'This overtime record will be marked as Cancelled and removed from pending authorization and active payroll totals. The original request history is preserved for audit.',
      reasonPlaceholder: 'Mandatory reason for cancelling this overtime (e.g. Granted comp-off, hours already accounted for)...',
    },
    purge_photo: {
      badge: 'PURGE ATTENDANCE PHOTO',
      badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      title: `Purge Photo for ${recordId}`,
      confirmBtnText: 'Permanently Purge Photo',
      confirmBtnColor: 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/30',
      warningText:
        'This attendance photo will be permanently purged from Cloudflare R2 storage under our privacy and data retention policy. The shift record, timestamps, and audit metadata are retained.',
      reasonPlaceholder: 'Mandatory reason (e.g. Routine 90-day privacy retention policy compliance)...',
    },
  };

  const currentConfig = config[actionType];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMandatoryReason && !reason.trim()) {
      setValidationError('A mandatory explanation reason is required for this action.');
      return;
    }
    if (isPhotoPurge && !policyAck) {
      setValidationError('You must acknowledge the retention and privacy policy.');
      return;
    }
    setValidationError(null);
    await onConfirm(reason.trim(), policyAck);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-start justify-between bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wider ${currentConfig.badgeColor}`}>
                {currentConfig.badge}
              </span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">{currentConfig.title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {recordTitle} {subtitle ? `• ${subtitle}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Explanation Alert */}
          <div
            className={`p-4 rounded-2xl text-xs space-y-1.5 border ${
              isRestore
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                : 'bg-slate-800/80 border-slate-700 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-xs">
              <span>{isRestore ? '✓' : '⚠️'}</span>
              <span>Consequences & Data Safety</span>
            </div>
            <p className="leading-relaxed opacity-90">{currentConfig.warningText}</p>
          </div>

          {/* Validation Error Banner */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{validationError}</span>
            </div>
          )}

          {/* Reason Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                {isMandatoryReason ? 'Mandatory Reason *' : 'Reason / Note (Optional)'}
              </label>
              {isMandatoryReason && (
                <span className="text-[10px] text-amber-400 font-medium">Required for Audit Trail</span>
              )}
            </div>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder={currentConfig.reasonPlaceholder}
              rows={3}
              disabled={isSubmitting}
              className="w-full bg-slate-950/80 border border-slate-700 text-white rounded-xl p-3 text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Retention Policy Checkbox for Photo Deletion */}
          {isPhotoPurge && (
            <label className="flex items-start gap-3 p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={policyAck}
                onChange={(e) => {
                  setPolicyAck(e.target.checked);
                  if (validationError) setValidationError(null);
                }}
                disabled={isSubmitting}
                className="mt-0.5 rounded border-slate-700 text-purple-600 focus:ring-purple-500"
              />
              <span className="leading-relaxed text-[11px]">
                I confirm that this attendance selfie is eligible for permanent removal under our privacy and data retention policy, and is not subject to an active investigation or dispute.
              </span>
            </label>
          )}

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-2 rounded-xl text-xs font-semibold shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 ${currentConfig.confirmBtnColor}`}
            >
              {isSubmitting && (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              <span>{isSubmitting ? 'Processing...' : currentConfig.confirmBtnText}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
