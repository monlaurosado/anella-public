export function DetailPaginationFields({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}) {
  return (
    <>
      <input type="hidden" name="returnPage" value={page} />
      <input type="hidden" name="returnPageSize" value={pageSize} />
    </>
  );
}
