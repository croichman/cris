-- CRIS — correção: criar perfil dava "Você não tem permissão para isso"
-- Causa: ao criar, o app pede o perfil recém-criado de volta. A regra de leitura de perfis
-- só consultava a função pode_ver_perfil(), que ainda não "enxerga" a linha que está
-- sendo criada. Voltamos a conferir os campos da própria linha (dono, vinculado, master,
-- sub-master) direto na regra, sempre dentro da família.
alter policy "perfis: ver" on public.perfis
  using (
    familia_id = public.minha_familia()
    and public.termo_aceito()
    and (
         dono_id = auth.uid()
      or usuario_vinculado_id = auth.uid()
      or public.eh_master()
      or public.sou_submaster_de(dono_id)
      or (usuario_vinculado_id is not null and public.sou_submaster_de(usuario_vinculado_id))
      or public.pode_ver_perfil(id)
    )
  );
