import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { REASON_MAX_LENGTH } from './build-return';

const QUICK_REASONS = ['Wrong size', 'Faulty', 'Changed mind'];

interface ReasonFieldProps {
  value: string;
  onChange: (reason: string) => void;
}

export function ReasonField({ value, onChange }: ReasonFieldProps) {
  return (
    <div className="space-y-2">
      <TextField
        label="Reason"
        value={value}
        onChange={onChange}
        maxLength={REASON_MAX_LENGTH}
        error={null}
      />
      <div className="flex flex-wrap gap-2">
        {QUICK_REASONS.map((reason) => (
          <Button key={reason} onClick={() => onChange(reason)}>
            {reason}
          </Button>
        ))}
      </div>
    </div>
  );
}
