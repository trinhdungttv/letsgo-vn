-- DỮ LIỆU MẪU — LỊCH SỬ LAO ĐỘNG (10 tuần / khách hàng)
DO $$
DECLARE
  cid UUID;
  client_names TEXT[] := ARRAY[
    'Changshin VN','TTP Vinawood','CP Việt Hưng','Hansae Vietnam',
    'Taekwang Vina','Korea Electronic VN','Pou Chen Vietnam','TNHH Minh Trang'
  ];
  week_labels TEXT[] := ARRAY['T4W1','T4W2','T4W3','T4W4','T5W1','T5W2','T5W3','T5W4','T6W1','T6W2'];
  all_counts INTEGER[] := ARRAY[
    295,298,305,310,308,315,318,312,312,314,
    82,85,87,87,85,84,85,87,87,87,
    140,142,145,145,143,145,145,145,145,145,
    200,202,205,208,210,208,206,208,208,210,
    168,170,172,176,174,172,170,176,176,178,
    90,92,94,94,92,90,90,94,94,94,
    410,415,418,421,418,420,421,421,421,425,
    60,62,63,63,63,63,63,63,63,63
  ];
  i INTEGER;
  j INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    SELECT id INTO cid FROM clients WHERE name = client_names[i];
    IF cid IS NOT NULL THEN
      FOR j IN 1..10 LOOP
        INSERT INTO client_labor_history (client_id, week_label, count)
        VALUES (cid, week_labels[j], all_counts[(i-1)*10 + j]);
      END LOOP;
    END IF;
  END LOOP;
END $$;
