import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addEventRegistrationQuestions = async () => {
  consola.info('Adding registration question tables');

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS template_registration_questions (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      template_id varchar(20) NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
      registration_option_id varchar(20) NOT NULL REFERENCES template_registration_options(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text,
      required boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS event_registration_questions (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      event_id varchar(20) NOT NULL REFERENCES event_instances(id) ON DELETE CASCADE,
      registration_option_id varchar(20) NOT NULL REFERENCES event_registration_options(id) ON DELETE CASCADE,
      source_template_question_id varchar(20) REFERENCES template_registration_questions(id) ON DELETE SET NULL,
      title text NOT NULL,
      description text,
      required boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0
    )
  `);

  consola.success('Registration question tables are available');
};
