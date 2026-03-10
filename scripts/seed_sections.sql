INSERT INTO sections (name) VALUES
('best_seller'),
('new_arrivals'),
('trending'),
('featured')
ON CONFLICT (name) DO NOTHING;
