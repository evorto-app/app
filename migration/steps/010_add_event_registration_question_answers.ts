import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addEventRegistrationQuestionAnswers = async () => {
  consola.info('Adding registration question answer table');

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS event_registration_question_answers (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      registration_id varchar(20) NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      question_id varchar(20) NOT NULL REFERENCES event_registration_questions(id) ON DELETE CASCADE,
      answer text NOT NULL,
      CONSTRAINT event_registration_question_answers_registration_question_unique
        UNIQUE (registration_id, question_id)
    )
  `);

  consola.success('Registration question answer table is available');
};
