export type ParsedPeriod='annual'|'quarterly'|'ttm';

export type ParsedFinancialLine={
  key:string;
  value:number;
  unit:string;
  period:ParsedPeriod;
  periodEnd:string;
  filedAt:string|null;
  form:string;
  accession:string|null;
  source:string;
};

export type ParsedFinancials={
  symbol:string;
  currency:string;
  entityName:string;
  lines:ParsedFinancialLine[];
};

export type ParsedFiling={
  accession:string;
  form:string;
  filedAt:string;
  periodEnd:string;
  url:string;
};

export type ParsedFilings={
  cik:string;
  filings:ParsedFiling[];
};
