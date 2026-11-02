import { useEffect, useState } from 'react';
import {
  LoaderCircle,
  Plus,
  SquarePen,
  Tags,
  Trash,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { Category, TxKind } from '../../shared/types';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useToast } from '../components/toast';
import {
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  PageLoading,
  Segmented,
} from '../components/ui';

const PALETTE = [
  '#1E5B45',
  '#2F6B4F',
  '#3D7C8A',
  '#4E6E81',
  '#7A6A3A',
  '#B0763A',
  '#A44A2A',
  '#8C5A6B',
  '#55624C',
  '#6B7280',
];

const KIND_LABEL: Record<TxKind, string> = { income: 'Thu nhập', expense: 'Chi phí' };

export function CategoriesPage() {
  const { revision, bump } = useApp();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ category: Category | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.categories
      .list()
      .then((list) => {
        if (alive) setCategories(list);
      })
      .catch((error) => {
        if (alive) toast(getErrorMessage(error), 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision, toast]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.categories.remove(deleteTarget.id);
      toast('Đã xoá danh mục.');
      setDeleteTarget(null);
      bump();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading && categories.length === 0) return <PageLoading />;

  const income = categories.filter((category) => category.kind === 'income');
  const expense = categories.filter((category) => category.kind === 'expense');

  return (
    <div className="page">
      <PageHeader
        title="Danh mục"
        subtitle="Phân loại các khoản thu và chi để báo cáo rõ ràng hơn."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModal({ category: null })}>
            <Plus size={16} />
            Thêm danh mục
          </button>
        }
      />

      <div className="cat-grid">
        <CategoryPanel
          title="Thu nhập"
          kind="income"
          icon={<TrendingUp size={16} />}
          categories={income}
          onEdit={(category) => setModal({ category })}
          onDelete={setDeleteTarget}
        />
        <CategoryPanel
          title="Chi phí"
          kind="expense"
          icon={<TrendingDown size={16} />}
          categories={expense}
          onEdit={(category) => setModal({ category })}
          onDelete={setDeleteTarget}
        />
      </div>

      {categories.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Tags size={22} />}
            title="Chưa có danh mục"
            description="Tạo danh mục đầu tiên để bắt đầu phân loại giao dịch."
          >
            <button type="button" className="btn btn-primary" onClick={() => setModal({ category: null })}>
              <Plus size={16} />
              Thêm danh mục
            </button>
          </EmptyState>
        </div>
      ) : null}

      {modal ? (
        <CategoryModal
          category={modal.category}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            bump();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Xoá danh mục?"
          description={
            <>
              Danh mục <strong>{deleteTarget.name}</strong> sẽ bị xoá. Chỉ có thể xoá khi không còn giao dịch
              nào sử dụng.
            </>
          }
          confirmLabel="Xoá danh mục"
          danger
          busy={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function CategoryPanel({
  title,
  kind,
  icon,
  categories,
  onEdit,
  onDelete,
}: {
  title: string;
  kind: TxKind;
  icon: React.ReactNode;
  categories: Category[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  const used = categories.reduce((sum, category) => sum + category.usageCount, 0);
  return (
    <section className={`card cat-panel cat-panel-${kind}`}>
      <div className="card-head">
        <div className="cat-panel-title">
          <span className="cat-panel-icon">{icon}</span>
          <div>
            <h2>{title}</h2>
            <p>
              {categories.length} danh mục · {used} giao dịch
            </p>
          </div>
        </div>
      </div>
      <div className="cat-list">
        {categories.length === 0 ? <p className="muted-note">Chưa có danh mục nào.</p> : null}
        {categories.map((category) => (
          <div className="cat-item" key={category.id}>
            <span className="cat-name">
              <i className="dot" style={{ background: category.color }} />
              {category.name}
            </span>
            <span className="cat-usage">{category.usageCount} giao dịch</span>
            <div className="cat-actions">
              <button
                type="button"
                className="icon-btn sm"
                aria-label={`Sửa ${category.name}`}
                title="Sửa danh mục"
                onClick={() => onEdit(category)}
              >
                <SquarePen size={15} />
              </button>
              <button
                type="button"
                className="icon-btn sm danger"
                aria-label={`Xoá ${category.name}`}
                title={
                  category.usageCount > 0
                    ? 'Không thể xoá danh mục đang được sử dụng'
                    : 'Xoá danh mục'
                }
                disabled={category.usageCount > 0}
                onClick={() => onDelete(category)}
              >
                <Trash size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<TxKind>(category?.kind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? PALETTE[3]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Tên danh mục không được để trống.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (category) {
        await api.categories.update(category.id, { name, kind, color });
        toast('Đã cập nhật danh mục.');
      } else {
        await api.categories.create({ name, kind, color });
        toast('Đã thêm danh mục.');
      }
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={category ? 'Sửa danh mục' : 'Thêm danh mục'}
      subtitle={category ? 'Đổi tên hoặc màu nhận diện.' : 'Tạo nhóm phân loại cho giao dịch.'}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button type="submit" form="category-form" className="btn btn-primary" disabled={saving}>
            {saving ? <LoaderCircle size={15} className="spin" /> : null}
            {category ? 'Lưu thay đổi' : 'Thêm danh mục'}
          </button>
        </>
      }
    >
      <form id="category-form" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Tên danh mục</span>
          <input
            className="input"
            value={name}
            maxLength={60}
            autoFocus
            placeholder="Ví dụ: Chi phí văn phòng"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        {category ? (
          <div className="static-field">
            <span>Loại danh mục</span>
            <strong>{KIND_LABEL[category.kind]}</strong>
          </div>
        ) : (
          <div className="field">
            <span className="field-label">Loại danh mục</span>
            <Segmented
              value={kind}
              onChange={setKind}
              ariaLabel="Loại danh mục"
              options={[
                { value: 'expense', label: 'Chi phí' },
                { value: 'income', label: 'Thu nhập' },
              ]}
            />
          </div>
        )}

        <div className="field">
          <span className="field-label">Màu nhận diện</span>
          <div className="swatches">
            {PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`swatch${color.toUpperCase() === swatch ? ' selected' : ''}`}
                style={{ background: swatch }}
                aria-label={`Chọn màu ${swatch}`}
                aria-pressed={color.toUpperCase() === swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
